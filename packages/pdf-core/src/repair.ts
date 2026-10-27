// Saving a damaged PDF as a clean one. Loading already copes with a wrong or missing cross-reference table (the file is
// scanned for its objects); this also puts back a missing catalog or page tree, and writes everything out again with
// correct lengths and no leftovers.
import { PdfDocument, type Page } from './document.ts'
import { PdfParseError } from './errors.ts'
import { PdfRef, isDict, isName, name, type PdfDict, type PdfObj } from './objects.ts'
import { editDocument } from './rewrite.ts'

export type Repaired = {
  bytes: Uint8Array
  /** the file's object index was wrong or missing and had to be rebuilt by scanning */
  rebuilt: boolean
  /** the page tree was missing or inconsistent and has been rebuilt */
  treeFixed: boolean
  pages: number
}

/** the pages the document's tree gives; when it gives none, every page object in the file, in object order */
function findPages(doc: PdfDocument): { pages: Page[]; scanned: boolean } {
  let pages: Page[] = []
  try {
    pages = doc.pages()
  } catch {
    // a missing catalog or tree: fall through to the scan
  }
  if (pages.length) return { pages, scanned: false }
  const found = [...doc.objects].filter(([, o]) => isDict(o) && isName(o.get('Type'), 'Page')).sort(([a], [b]) => a - b)
  return { pages: found.map(([n, o]) => ({ ref: new PdfRef(n), dict: o as PdfDict, inherited: new Map() })), scanned: true }
}

export async function repairPdf(bytes: Uint8Array, options: { password?: string } = {}): Promise<Repaired> {
  const doc = await PdfDocument.load(bytes, { password: options.password, repair: true })
  // a catalog the trailer names but the file lost
  const root = doc.trailer.get('Root')
  if (root instanceof PdfRef && !isDict(doc.objects.get(root.num))) doc.objects.set(root.num, new Map<string, PdfObj>([['Type', name('Catalog')]]))
  const { pages, scanned } = findPages(doc)
  if (!pages.length) throw new PdfParseError("No pages could be found in this file, so there is nothing to recover.")
  let treeFixed = scanned
  if (!treeFixed) {
    const tree = doc.resolve(doc.catalog().get('Pages'))
    treeFixed = !isDict(tree) || doc.resolve(tree.get('Count')) !== pages.length || pages.some((p) => !p.ref)
  }
  const out = await editDocument(doc, (e) => {
    if (!treeFixed) return
    // one flat page tree; what pages used to inherit from the nodes above them is written onto each page
    const kids = pages.flatMap((p) => (p.ref ? [p.ref] : []))
    const tree = e.add(new Map<string, PdfObj>([['Type', name('Pages')], ['Kids', kids], ['Count', kids.length]]))
    for (const p of pages) {
      if (!p.ref) continue
      const d = e.edit(p.ref)
      for (const [k, v] of p.inherited) if (!d.has(k)) d.set(k, v)
      d.set('Type', name('Page'))
      d.set('Parent', tree)
    }
    e.catalog.set('Type', name('Catalog'))
    e.catalog.set('Pages', tree)
  })
  return { bytes: out, rebuilt: doc.rebuilt, treeFixed, pages: pages.length }
}
