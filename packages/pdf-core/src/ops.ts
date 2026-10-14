import { PdfName, PdfRef, PdfStream, PdfString, isName, name, type PdfDict, type PdfObj } from './objects.ts'
import type { Page, PdfDocument } from './document.ts'
import { PdfBuilder, serializeDocument } from './writer.ts'
import { PdfDocument as Doc } from './document.ts'
import { PdfRangeError } from './errors.ts'
import { ascii } from './bytes.ts'
import { encodeTextString } from './info.ts'
import { explicitDestination, readOutline, remapOutline, writeOutline } from './outline.ts'
import { acroForm } from './forms.ts'

type Part = {
  doc: PdfDocument
  /** 0-based page indices to take, in output order */
  pages: number[]
  /** degrees to add to a page's rotation, by its index in the source document */
  rotate?: (index: number) => number
  /** change a page's dictionary in the source's terms, before anything it refers to is copied: what it no longer names is left out of the output */
  prepare?: (index: number, dict: PdfDict, source: Page) => void
  /** change a page's dictionary after it was copied into the builder (`out` already points at builder objects) */
  edit?: (index: number, out: PdfDict, b: PdfBuilder, source: Page) => void
}

export type ComposeOptions = {
  /** string entries for the output's /Info; Producer defaults to "Ream" */
  info?: Record<string, string>
}

/** Deep-copies objects from one source document into a builder, renumbering references. */
class Importer {
  doc: PdfDocument
  b: PdfBuilder
  map = new Map<number, PdfRef>()
  chosen = new Map<number, PdfRef>()
  sourcePages: Set<number>
  /** the field nodes of the source's form (objects with a /T), and the annotations on the pages being copied: what decides which fields survive */
  formNodes = new Set<number>()
  keptAnnots = new Set<number>()
  alive = new Map<number, boolean>()

  constructor(doc: PdfDocument, b: PdfBuilder, all: Page[]) {
    this.doc = doc
    this.b = b
    this.sourcePages = new Set(all.flatMap((p) => (p.ref ? [p.ref.num] : [])))
    const top = acroForm(doc)?.get('Fields')
    const walk = (list: PdfObj, depth: number) => {
      const a = doc.resolve(list)
      if (!Array.isArray(a) || depth > 32) return
      for (const k of a) {
        const d = doc.resolve(k)
        if (k instanceof PdfRef && d instanceof Map && !this.formNodes.has(k.num) && (d.has('T') || depth === 0)) {
          this.formNodes.add(k.num)
          walk(d.get('Kids') ?? null, depth + 1)
        }
      }
    }
    if (top) walk(top, 0)
  }

  /** a field stays if a widget of it, or of a field below it, is on a page being copied */
  isAlive(num: number, depth = 0): boolean {
    const known = this.alive.get(num)
    if (known !== undefined) return known
    this.alive.set(num, false) // a loop through /Kids counts as nothing
    const d = this.doc.objects.get(num)
    let yes = this.keptAnnots.has(num)
    const kids = d instanceof Map ? this.doc.resolve(d.get('Kids')) : null
    if (!yes && Array.isArray(kids) && depth < 32) yes = kids.some((k) => k instanceof PdfRef && (this.formNodes.has(k.num) ? this.isAlive(k.num, depth + 1) : this.keptAnnots.has(k.num)))
    this.alive.set(num, yes)
    return yes
  }

  /** a field with only the widgets (and fields) that are still on a page; null when nothing of it is left */
  copyField(ref: PdfRef): PdfRef | null {
    const seen = this.map.get(ref.num)
    if (seen) return seen
    if (!this.isAlive(ref.num)) return null
    const d = this.doc.objects.get(ref.num) as PdfDict
    const out = this.b.reserve()
    this.map.set(ref.num, out)
    const copy: PdfDict = new Map()
    for (const [k, v] of d) {
      if (k === 'Kids') {
        const kids = this.doc.resolve(v)
        copy.set('Kids', (Array.isArray(kids) ? kids : []).filter((r) => r instanceof PdfRef && (this.formNodes.has(r.num) ? this.isAlive(r.num) : this.keptAnnots.has(r.num))).map((r) => this.copy(r)))
      } else copy.set(k, this.copy(v))
    }
    this.b.set(out, copy)
    return out
  }

  copy(o: PdfObj): PdfObj {
    if (o instanceof PdfRef) {
      const page = this.chosen.get(o.num)
      if (page) return page
      // links and /P entries pointing at pages we dropped become null
      if (this.sourcePages.has(o.num)) return null
      if (this.formNodes.has(o.num)) return this.copyField(o)
      const seen = this.map.get(o.num)
      if (seen) return seen
      const target = this.doc.objects.get(o.num)
      if (target === undefined) return null
      const ref = this.b.reserve()
      this.map.set(o.num, ref)
      this.b.set(ref, this.copy(target))
      return ref
    }
    if (Array.isArray(o)) return o.map((x) => this.copy(x))
    if (o instanceof Map) return new Map([...this.namedToExplicit(o)].map(([k, v]) => [k, this.copy(v)]))
    if (o instanceof PdfStream) {
      const d = this.copy(o.dict) as PdfDict
      d.delete('Length')
      return new PdfStream(d, o.data)
    }
    return o
  }

  /**
   * A link or GoTo action that names its destination would point at nothing once the file has no name tree, so it is
   * given the destination itself; if that page was left out the destination goes.
   */
  namedToExplicit(o: PdfDict): PdfDict {
    const key = isName(this.doc.resolve(o.get('S')), 'GoTo') ? 'D' : 'Dest'
    const v = this.doc.resolve(o.get(key))
    if (!(v instanceof PdfString || v instanceof PdfName)) return o
    const dest = explicitDestination(this.doc, v)
    const out = new Map(o)
    if (dest?.[0] instanceof PdfRef && this.chosen.has(dest[0].num)) out.set(key, dest)
    else out.delete(key)
    return out
  }

  /** give each picked page its object number now, so a link on any page can point at any other picked page */
  claim(pages: { page: Page }[]): PdfRef[] {
    const refs = pages.map(() => this.b.reserve())
    pages.forEach(({ page }, i) => {
      if (page.ref) this.chosen.set(page.ref.num, refs[i])
      const annots = this.doc.resolve(page.dict.get('Annots'))
      if (Array.isArray(annots)) for (const a of annots) if (a instanceof PdfRef) this.keptAnnots.add(a.num)
    })
    return refs
  }

  copyPages(pages: { page: Page; index: number }[], refs: PdfRef[], parent: PdfRef, part: Pick<Part, 'rotate' | 'edit' | 'prepare'>) {
    pages.forEach(({ page, index }, i) => {
      const d: PdfDict = new Map(page.dict)
      d.delete('Parent')
      for (const [k, v] of page.inherited) if (!d.has(k)) d.set(k, v)
      const delta = part.rotate?.(index) ?? 0
      if (delta) {
        const cur = this.doc.resolve(d.get('Rotate'))
        d.set('Rotate', ((((typeof cur === 'number' ? cur : 0) + delta) % 360) + 360) % 360)
      }
      part.prepare?.(index, d, page)
      const out = this.copy(d) as PdfDict
      out.set('Parent', parent)
      part.edit?.(index, out, this.b, page)
      this.b.set(refs[i], out)
    })
  }
}

/** Build a new PDF from page selections of one or more documents. Everything below is a thin wrapper over this. */
export function compose(parts: Part[], options: ComposeOptions = {}): Uint8Array {
  const b = new PdfBuilder()
  const catalog = b.reserve()
  const pagesRef = b.reserve()
  const kids: PdfRef[] = []
  // one importer per source document, so a document used by several parts (reordered or repeated pages) is copied once
  const importers = new Map<PdfDocument, Importer>()
  const jobs: (() => void)[] = []
  const placed = new Map<PdfDocument, Map<number, number>>() // source page index -> first position in the output
  for (const part of parts) {
    const all = part.doc.pages()
    const picked = part.pages.map((index) => {
      if (!Number.isInteger(index) || index < 0 || index >= all.length) throw new PdfRangeError(`Page ${index + 1} doesn't exist`)
      return { page: all[index], index }
    })
    let importer = importers.get(part.doc)
    if (!importer) importers.set(part.doc, (importer = new Importer(part.doc, b, all)))
    const where = placed.get(part.doc) ?? new Map<number, number>()
    placed.set(part.doc, where)
    picked.forEach(({ index }, i) => where.has(index) || where.set(index, kids.length + i))
    const refs = importer.claim(picked)
    kids.push(...refs)
    jobs.push(() => importer!.copyPages(picked, refs, pagesRef, part))
  }
  for (const job of jobs) job()
  if (!kids.length) throw new PdfRangeError("That would leave a PDF with no pages")
  b.set(pagesRef, new Map<string, PdfObj>([['Type', name('Pages')], ['Kids', kids], ['Count', kids.length]]))
  const cat = new Map<string, PdfObj>([['Type', name('Catalog')], ['Pages', pagesRef]])
  // bookmarks follow their pages: dropped pages take their entries with them, several inputs are listed one after another
  const items = [...placed].flatMap(([doc, where]) => remapOutline(readOutline(doc), (p) => where.get(p) ?? null))
  const outlines = writeOutline(b, items, kids)
  if (outlines) cat.set('Outlines', outlines)
  // form fields: the ones with a widget on a kept page, with the form's defaults
  const forms = [...importers].flatMap(([doc, imp]) => {
    const form = acroForm(doc)
    const top = form && doc.resolve(form.get('Fields'))
    if (!form || !Array.isArray(top)) return []
    const fields = top.map((f) => (f instanceof PdfRef ? imp.copy(f) : null)).filter((f): f is PdfRef => f instanceof PdfRef)
    return fields.length ? [{ form, imp, doc, fields }] : []
  })
  if (forms.length) {
    const out: PdfDict = new Map<string, PdfObj>([['Fields', forms.flatMap((f) => f.fields)]])
    const dr: PdfDict = new Map()
    for (const { form, imp, doc } of forms) {
      const r = doc.resolve(form.get('DR'))
      if (r instanceof Map) {
        const copy = imp.copy(r) as PdfDict
        // resources of the same kind are joined; when two forms use a name for different things the first keeps it
        for (const [kind, v] of copy) {
          const have = dr.get(kind)
          if (have instanceof Map && v instanceof Map) for (const [k2, v2] of v) have.has(k2) || have.set(k2, v2)
          else if (!dr.has(kind)) dr.set(kind, v)
        }
      }
      for (const key of ['DA', 'Q']) if (form.has(key) && !out.has(key)) out.set(key, imp.copy(form.get(key) ?? null))
      if (doc.resolve(form.get('NeedAppearances')) === true) out.set('NeedAppearances', true)
    }
    if (dr.size) out.set('DR', dr)
    cat.set('AcroForm', out)
  }
  // the first input's language and viewer settings
  const [first, firstImporter] = [...importers][0]
  const src = (() => { try { return first.catalog() } catch { return new Map<string, PdfObj>() } })()
  for (const k of ['Lang', 'ViewerPreferences']) if (src.has(k)) cat.set(k, firstImporter.copy(src.get(k) ?? null))
  // ponytail: tagged structure, layers and page labels are not carried over yet
  b.set(catalog, cat)
  const entries: [string, PdfObj][] = [['Producer', new PdfString(ascii('Ream'))]]
  for (const [k, v] of Object.entries(options.info ?? {})) entries.push([k, encodeTextString(v)])
  const info = b.add(new Map<string, PdfObj>(entries))
  return b.serialize(catalog, info)
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

export function merge(inputs: { doc: PdfDocument; pages?: number[] }[]): Uint8Array {
  return compose(inputs.map(({ doc, pages }) => ({ doc, pages: pages ?? range(doc.pages().length) })))
}

/** keep only these pages (0-based), in the order given */
export function extract(doc: PdfDocument, pages: number[]): Uint8Array {
  return compose([{ doc, pages }])
}

export function remove(doc: PdfDocument, pages: number[]): Uint8Array {
  const drop = new Set(pages)
  return compose([{ doc, pages: range(doc.pages().length).filter((i) => !drop.has(i)) }])
}

/** one output file per group of page indices */
export function split(doc: PdfDocument, groups: number[][]): Uint8Array[] {
  return groups.map((pages) => compose([{ doc, pages }]))
}

/** rotate the given pages (default all) clockwise by a multiple of 90 degrees */
export function rotate(doc: PdfDocument, angle: number, pages?: number[]): Uint8Array {
  if (!Number.isInteger(angle) || angle % 90 !== 0) throw new PdfRangeError('Rotation must be a multiple of 90 degrees')
  const only = pages ? new Set(pages) : null
  return compose([{ doc, pages: range(doc.pages().length), rotate: (i) => (!only || only.has(i) ? angle : 0) }])
}

/**
 * The same PDF without its password protection. Throws PdfPasswordError for a missing or wrong password; a file that
 * wasn't protected comes back unchanged.
 */
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await Doc.load(bytes, { password })
  return doc.encrypted ? serializeDocument(doc) : bytes
}
