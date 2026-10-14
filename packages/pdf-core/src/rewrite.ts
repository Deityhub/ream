// Changing a document in place: every object stays as it was except those the caller touches, so bookmarks, forms,
// links and everything else survive (unlike `compose`, which builds a new file from pages).
import { PdfDocument } from './document.ts'
import { PdfRef, PdfStream, isDict, isName, type PdfDict, type PdfObj } from './objects.ts'
import { optimize } from './optimize.ts'
import { PdfParseError } from './errors.ts'

export type Editing = {
  /** the catalog, already a private copy that may be changed */
  catalog: PdfDict
  /** the document being edited, as it was */
  doc: PdfDocument
  /** add an object and get its reference */
  add(o: PdfObj): PdfRef
  /** take an object number now and fill it later with `set` */
  reserve(): PdfRef
  set(ref: PdfRef, o: PdfObj): void
  /** a private copy of a dictionary (or of a stream's dictionary) that may be changed; the same copy on every call */
  edit(ref: PdfRef): PdfDict
  /** the page objects in order (null for a page that is not an indirect object) */
  pageRefs: (PdfRef | null)[]
}

/**
 * Rewrite a document after `change` has altered it. The result drops what is no longer reachable (an old bookmark tree
 * that was replaced, say) and is written as a plain classic-xref file. An encrypted source comes out decrypted.
 */
export async function editDocument(doc: PdfDocument, change: (e: Editing) => void | Promise<void>): Promise<Uint8Array> {
  const root = doc.trailer.get('Root')
  if (!(root instanceof PdfRef)) throw new PdfParseError("This PDF has no document catalog; the file may be damaged.")
  const objects = new Map<number, PdfObj>()
  for (const [n, o] of doc.objects) {
    const container = o instanceof PdfStream && (isName(o.dict.get('Type'), 'XRef') || isName(o.dict.get('Type'), 'ObjStm'))
    if (!container) objects.set(n, o)
  }
  let next = Math.max(0, ...doc.objects.keys()) + 1
  const copies = new Set<number>()
  const edit = (ref: PdfRef): PdfDict => {
    const o = objects.get(ref.num)
    const d = o instanceof PdfStream ? o.dict : o
    if (!isDict(d)) throw new PdfParseError('A part of this PDF is damaged.')
    if (copies.has(ref.num)) return d
    copies.add(ref.num)
    const copy = new Map(d)
    objects.set(ref.num, o instanceof PdfStream ? new PdfStream(copy, o.data) : copy)
    return copy
  }
  const catalog = edit(root)
  await change({
    catalog,
    doc,
    add: (o) => {
      objects.set(next, o)
      return new PdfRef(next++)
    },
    reserve: () => {
      objects.set(next, null)
      return new PdfRef(next++)
    },
    set: (ref, o) => void objects.set(ref.num, o),
    edit,
    pageRefs: doc.pages().map((p) => p.ref),
  })
  const trailer: PdfDict = new Map([['Root', root]])
  const info = doc.trailer.get('Info')
  if (info instanceof PdfRef) trailer.set('Info', info)
  const id = doc.trailer.get('ID')
  if (id) trailer.set('ID', id)
  return optimize(new PdfDocument(objects, trailer), { tidy: true, objectStreams: false })
}
