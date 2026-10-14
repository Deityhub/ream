// Bookmarks (the /Outlines tree) and named destinations, as plain data so a panel can edit them and `compose` can carry them
// over to a new file.
import { PdfName, PdfRef, PdfString, isDict, isName, name, type PdfDict, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'
import { decodeTextString, encodeTextString } from './info.ts'

/** one bookmark. `page` is a 0-based index into the document's pages, null for a heading that goes nowhere */
export type OutlineItem = {
  title: string
  page: number | null
  /** how the page is shown after the page itself: ['XYZ', left, top, zoom], ['Fit'], ['FitH', top] ... Names are strings. */
  fit: (string | number | null)[]
  open: boolean
  children: OutlineItem[]
}

const MAX_ITEMS = 50_000
const MAX_DEPTH = 32

// ---------- named destinations ----------

const keyOf = (o: PdfObj): string | null => (o instanceof PdfString ? String.fromCharCode(...o.bytes) : o instanceof PdfName ? o.value : null)
const cache = new WeakMap<PdfDocument, Map<string, PdfObj[]>>()

/** every named destination of the document (the old /Dests dictionary and the /Names /Dests name tree), by name */
export function namedDestinations(doc: PdfDocument): Map<string, PdfObj[]> {
  const known = cache.get(doc)
  if (known) return known
  const out = new Map<string, PdfObj[]>()
  cache.set(doc, out)
  const add = (key: string | null, value: PdfObj) => {
    let v = doc.resolve(value)
    if (isDict(v)) v = doc.resolve(v.get('D'))
    if (key !== null && Array.isArray(v) && !out.has(key)) out.set(key, v)
  }
  let cat: PdfDict
  try {
    cat = doc.catalog()
  } catch {
    return out
  }
  const old = doc.resolve(cat.get('Dests'))
  if (isDict(old)) for (const [k, v] of old) add(k, v)
  const seen = new Set<PdfDict>()
  const walk = (node: PdfObj, depth: number) => {
    const d = doc.resolve(node)
    if (!isDict(d) || seen.has(d) || depth > MAX_DEPTH) return
    seen.add(d)
    const names = doc.resolve(d.get('Names'))
    if (Array.isArray(names)) for (let i = 0; i + 1 < names.length; i += 2) add(keyOf(doc.resolve(names[i])), names[i + 1])
    const kids = doc.resolve(d.get('Kids'))
    if (Array.isArray(kids)) for (const k of kids) walk(k, depth + 1)
  }
  const names = doc.resolve(cat.get('Names'))
  if (isDict(names)) walk(names.get('Dests') ?? null, 0)
  return out
}

/** the explicit destination array a /Dest or a GoTo action's /D stands for: given directly, or by name */
export function explicitDestination(doc: PdfDocument, dest: PdfObj | undefined): PdfObj[] | null {
  const d = doc.resolve(dest)
  if (Array.isArray(d)) return d
  const key = keyOf(d)
  if (key !== null) return namedDestinations(doc).get(key) ?? null
  if (isDict(d)) return explicitDestination(doc, d.get('D'))
  return null
}

// ---------- reading ----------

const plain = (o: PdfObj): string | number | null => (o instanceof PdfName ? o.value : typeof o === 'number' ? o : null)

/** the bookmarks of a document, nested; an empty list when there are none or the tree is unreadable */
export function readOutline(doc: PdfDocument): OutlineItem[] {
  let root: PdfObj
  try {
    root = doc.resolve(doc.catalog().get('Outlines'))
  } catch {
    return []
  }
  if (!isDict(root)) return []
  const pageOf = new Map<number, number>()
  doc.pages().forEach((p, i) => p.ref && pageOf.set(p.ref.num, i))
  let budget = MAX_ITEMS
  const seen = new Set<PdfDict>()

  const target = (item: PdfDict) => {
    let dest: PdfObj | undefined = item.get('Dest')
    if (dest === undefined) {
      const a = doc.resolve(item.get('A'))
      if (isDict(a) && isName(doc.resolve(a.get('S')), 'GoTo')) dest = a.get('D')
    }
    const arr = explicitDestination(doc, dest)
    const first = arr?.[0]
    const page = first instanceof PdfRef ? (pageOf.get(first.num) ?? null) : null
    return { page, fit: page === null ? [] : (arr ?? []).slice(1).map((x) => plain(doc.resolve(x))) }
  }

  const level = (first: PdfObj | undefined, depth: number): OutlineItem[] => {
    const items: OutlineItem[] = []
    let node = doc.resolve(first)
    while (isDict(node) && !seen.has(node) && budget-- > 0) {
      seen.add(node)
      const title = doc.resolve(node.get('Title'))
      const { page, fit } = target(node)
      const count = doc.resolve(node.get('Count'))
      items.push({
        title: title instanceof PdfString ? decodeTextString(title.bytes) : '',
        page,
        fit,
        open: typeof count === 'number' && count > 0,
        children: depth < MAX_DEPTH ? level(node.get('First'), depth + 1) : [],
      })
      node = doc.resolve(node.get('Next'))
    }
    return items
  }
  return level(root.get('First'), 0)
}

// ---------- changing and writing ----------

/**
 * Carry bookmarks over to a file with other pages: `where` says the new index of a page (null when it is gone).
 * An entry whose page is gone but which still has entries below it stays as a heading; one with nothing left goes.
 */
export function remapOutline(items: OutlineItem[], where: (page: number) => number | null): OutlineItem[] {
  const out: OutlineItem[] = []
  for (const it of items) {
    const children = remapOutline(it.children, where)
    const page = it.page === null ? null : where(it.page)
    if (page === null && !children.length && it.page !== null) continue
    out.push({ ...it, page, fit: page === null ? [] : it.fit, children })
  }
  return out
}

/** how many entries show when this one is open (all open levels below it) */
const visible = (it: OutlineItem): number => it.children.reduce((n, c) => n + 1 + (c.open ? visible(c) : 0), 0)

/** where objects are put: a `PdfBuilder`, or the `Editing` of `editDocument` */
export type ObjectSink = { reserve(): PdfRef; set(ref: PdfRef, o: PdfObj): void }

/** Write the tree as an /Outlines object and return it (null for an empty tree). `pageRefs[i]` is page i's object in the builder. */
export function writeOutline(b: ObjectSink, items: OutlineItem[], pageRefs: (PdfRef | null)[]): PdfRef | null {
  if (!items.length) return null
  const root = b.reserve()
  const build = (list: OutlineItem[], parent: PdfRef): { first: PdfRef; last: PdfRef } => {
    const refs = list.map(() => b.reserve())
    list.forEach((it, i) => {
      const d: PdfDict = new Map<string, PdfObj>([['Title', encodeTextString(it.title)], ['Parent', parent]])
      if (i > 0) d.set('Prev', refs[i - 1])
      if (i < list.length - 1) d.set('Next', refs[i + 1])
      const page = it.page === null ? null : (pageRefs[it.page] ?? null)
      if (page) d.set('Dest', [page, ...(it.fit.length ? it.fit : ['Fit']).map((x) => (typeof x === 'string' ? name(x) : x))])
      if (it.children.length) {
        const { first, last } = build(it.children, refs[i])
        d.set('First', first)
        d.set('Last', last)
        d.set('Count', it.open ? visible(it) : -visible(it))
      }
      b.set(refs[i], d)
    })
    return { first: refs[0], last: refs[refs.length - 1] }
  }
  const { first, last } = build(items, root)
  b.set(root, new Map<string, PdfObj>([['Type', name('Outlines')], ['First', first], ['Last', last], ['Count', visible({ title: '', page: null, fit: [], open: true, children: items })]]))
  return root
}
