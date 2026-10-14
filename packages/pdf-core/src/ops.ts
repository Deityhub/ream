import { PdfRef, PdfStream, PdfString, name, type PdfDict, type PdfObj } from './objects.ts'
import type { Page, PdfDocument } from './document.ts'
import { PdfBuilder, serializeDocument } from './writer.ts'
import { PdfDocument as Doc } from './document.ts'
import { PdfRangeError } from './errors.ts'
import { ascii } from './bytes.ts'
import { encodeTextString } from './info.ts'

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

  constructor(doc: PdfDocument, b: PdfBuilder, all: Page[]) {
    this.doc = doc
    this.b = b
    this.sourcePages = new Set(all.flatMap((p) => (p.ref ? [p.ref.num] : [])))
  }

  copy(o: PdfObj): PdfObj {
    if (o instanceof PdfRef) {
      const page = this.chosen.get(o.num)
      if (page) return page
      // ponytail: links and /P entries pointing at pages we dropped become null; fix up with named destinations in M7
      if (this.sourcePages.has(o.num)) return null
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
    if (o instanceof Map) return new Map([...o].map(([k, v]) => [k, this.copy(v)]))
    if (o instanceof PdfStream) {
      const d = this.copy(o.dict) as PdfDict
      d.delete('Length')
      return new PdfStream(d, o.data)
    }
    return o
  }

  copyPages(pages: { page: Page; index: number }[], parent: PdfRef, part: Pick<Part, 'rotate' | 'edit' | 'prepare'>): PdfRef[] {
    const refs = pages.map(() => this.b.reserve())
    pages.forEach(({ page }, i) => {
      if (page.ref) this.chosen.set(page.ref.num, refs[i])
    })
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
    return refs
  }
}

/** Build a new PDF from page selections of one or more documents. Everything below is a thin wrapper over this. */
export function compose(parts: Part[], options: ComposeOptions = {}): Uint8Array {
  const b = new PdfBuilder()
  const catalog = b.reserve()
  const pagesRef = b.reserve()
  const kids: PdfRef[] = []
  for (const part of parts) {
    const all = part.doc.pages()
    const picked = part.pages.map((index) => {
      if (!Number.isInteger(index) || index < 0 || index >= all.length) throw new PdfRangeError(`Page ${index + 1} doesn't exist`)
      return { page: all[index], index }
    })
    kids.push(...new Importer(part.doc, b, all).copyPages(picked, pagesRef, part))
  }
  if (!kids.length) throw new PdfRangeError("That would leave a PDF with no pages")
  b.set(pagesRef, new Map<string, PdfObj>([['Type', name('Pages')], ['Kids', kids], ['Count', kids.length]]))
  // ponytail: bookmarks, AcroForm and named destinations are not carried over yet (M7)
  b.set(catalog, new Map<string, PdfObj>([['Type', name('Catalog')], ['Pages', pagesRef]]))
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
