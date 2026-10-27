import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfRef, editDocument, extract, merge, readOutline, remove, writeOutline, type OutlineItem } from '../src/index.ts'
import { assemble } from './helpers.ts'

const stream = (c: string) => `<< /Length ${c.length} >>\nstream\n${c}\nendstream`
const page = (n: number, extra = '') => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents ${n + 1} 0 R ${extra} >>`

/** four pages A-D; bookmarks: Chapter 1 (page A, XYZ) > Section 1.1 (B), Chapter 2 (C, by name in /Dests), Chapter 3 (D, GoTo by name in the name tree) */
function book(titles = ['Chapter 1', 'Section 1.1', 'Chapter 2', 'Chapter 3']): Uint8Array {
  return assemble([
    [1, '<< /Type /Catalog /Pages 2 0 R /Outlines 20 0 R /Dests 30 0 R /Names << /Dests 31 0 R >> /Lang (en) >>'],
    [2, '<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R] /Count 4 >>'],
    [4, page(4, '/Annots [40 0 R 41 0 R]')], [5, stream('A')],
    [6, page(6)], [7, stream('B')],
    [8, page(8)], [9, stream('C')],
    [10, page(10)], [11, stream('D')],
    [20, '<< /Type /Outlines /First 21 0 R /Last 24 0 R /Count 4 >>'],
    [21, `<< /Title (${titles[0]}) /Parent 20 0 R /Dest [4 0 R /XYZ 0 100 null] /First 22 0 R /Last 22 0 R /Count 1 /Next 23 0 R >>`],
    [22, `<< /Title (${titles[1]}) /Parent 21 0 R /Dest [6 0 R /Fit] >>`],
    [23, `<< /Title (${titles[2]}) /Parent 20 0 R /Dest /ch2 /Prev 21 0 R /Next 24 0 R >>`],
    [24, `<< /Title (${titles[3]}) /Parent 20 0 R /A << /S /GoTo /D (ch3) >> /Prev 23 0 R >>`],
    [30, '<< /ch2 [8 0 R /Fit] >>'],
    [31, '<< /Names [(ch3) [10 0 R /FitH 50]] >>'],
    [40, '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /Dest (ch3) >>'],
    [41, '<< /Type /Annot /Subtype /Link /Rect [20 0 30 10] /A << /S /GoTo /D /ch2 >> >>'],
  ]).bytes
}

const flat = (items: OutlineItem[], depth = 0): string[] => items.flatMap((i) => [`${'-'.repeat(depth)}${i.title}:${i.page}`, ...flat(i.children, depth + 1)])
const outlineOf = async (bytes: Uint8Array) => flat(readOutline(await PdfDocument.load(bytes)))
const annotsOf = async (bytes: Uint8Array, pageIndex: number) => {
  const doc = await PdfDocument.load(bytes)
  const pages = doc.pages()
  const annots = doc.resolve(pages[pageIndex].dict.get('Annots'))
  return { doc, pages, annots: (Array.isArray(annots) ? annots : []).map((a) => doc.resolve(a) as Map<string, unknown>) }
}

describe('readOutline', () => {
  test('nesting, pages, how the page is shown, and destinations given by name', async () => {
    const items = readOutline(await PdfDocument.load(book()))
    expect(flat(items)).toEqual(['Chapter 1:0', '-Section 1.1:1', 'Chapter 2:2', 'Chapter 3:3'])
    expect(items[0].fit).toEqual(['XYZ', 0, 100, null])
    expect(items[0].open).toBe(true)
    expect(items[0].children[0].open).toBe(false)
    expect(items[2].fit).toEqual(['FitH', 50])
  })

  test('a file without bookmarks, and a looping tree, give something sensible', async () => {
    expect(readOutline(await PdfDocument.load(assemble([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [] /Count 0 >>']]).bytes))).toEqual([])
    const loop = assemble([
      [1, '<< /Type /Catalog /Pages 2 0 R /Outlines 20 0 R >>'], [2, '<< /Type /Pages /Kids [] /Count 0 >>'],
      [20, '<< /Type /Outlines /First 21 0 R >>'], [21, '<< /Title (a) /Next 21 0 R >>'],
    ]).bytes
    expect(readOutline(await PdfDocument.load(loop)).map((i) => i.title)).toEqual(['a'])
  })
})

describe('bookmarks through the page tools', () => {
  test('extracting pages keeps the bookmarks that still have a page and renumbers them', async () => {
    expect(await outlineOf(extract(await PdfDocument.load(book()), [2, 3]))).toEqual(['Chapter 2:0', 'Chapter 3:1'])
    expect(await outlineOf(extract(await PdfDocument.load(book()), [1]))).toEqual(['Chapter 1:null', '-Section 1.1:0']) // the parent stays as a heading
    expect(await outlineOf(remove(await PdfDocument.load(book()), [0, 1]))).toEqual(['Chapter 2:0', 'Chapter 3:1'])
  })

  test('reordered and repeated pages: entries follow the pages, the first copy is the target', async () => {
    expect(await outlineOf(extract(await PdfDocument.load(book()), [3, 0, 2]))).toEqual(['Chapter 1:1', 'Chapter 2:2', 'Chapter 3:0'])
    expect(await outlineOf(extract(await PdfDocument.load(book()), [2, 2, 0]))).toEqual(['Chapter 1:2', 'Chapter 2:0'])
  })

  test('merged files list their bookmarks one after another', async () => {
    const a = await PdfDocument.load(book())
    const out = await outlineOf(merge([{ doc: a, pages: [0, 1] }, { doc: a, pages: [3] }, { doc: await PdfDocument.load(book(['X', 'Y', 'Z', 'W'])), pages: [2] }]))
    expect(out).toEqual(['Chapter 1:0', '-Section 1.1:1', 'Chapter 3:2', 'Z:3'])
  })

  test('the entry ends up with the same nesting and the file keeps its language', async () => {
    const out = extract(await PdfDocument.load(book()), [0, 1, 2, 3])
    const doc = await PdfDocument.load(out)
    expect(readOutline(doc).map((i) => i.children.length)).toEqual([1, 0, 0])
    expect(doc.catalog().has('Lang')).toBe(true)
    // each target is the page object itself in the new file
    const root = doc.resolve(doc.catalog().get('Outlines')) as Map<string, unknown>
    const first = doc.resolve(root.get('First') as never) as Map<string, unknown>
    const dest = first.get('Dest') as unknown[]
    expect((dest[0] as PdfRef).num).toBe(doc.pages()[0].ref!.num)
  })

  test('links by name get the destination itself, and lose it when the page is gone', async () => {
    const kept = await annotsOf(extract(await PdfDocument.load(book()), [0, 2, 3]), 0)
    const [toCh3, toCh2] = kept.annots
    expect((toCh3.get('Dest') as unknown[])[0]).toEqual(kept.pages[2].ref)
    expect(((toCh2.get('A') as Map<string, unknown>).get('D') as unknown[])[0]).toEqual(kept.pages[1].ref)
    // the page a link points at may come from a later part of the same document
    const a = await PdfDocument.load(book())
    const two = await annotsOf(merge([{ doc: a, pages: [0, 1] }, { doc: a, pages: [3] }]), 0)
    expect((two.annots[0].get('Dest') as unknown[])[0]).toEqual(two.pages[2].ref)
    const gone = await annotsOf(extract(await PdfDocument.load(book()), [0, 1]), 0)
    expect(gone.annots[0].has('Dest')).toBe(false)
    expect((gone.annots[1].get('A') as Map<string, unknown>).has('D')).toBe(false)
  })
})

describe('editDocument and writeOutline', () => {
  test('a new tree replaces the old one; the old titles are gone from the file; the rest is untouched', async () => {
    const doc = await PdfDocument.load(book())
    const tree: OutlineItem[] = [{ title: 'Début', page: 3, fit: ['Fit'], open: true, children: [{ title: 'Two', page: 1, fit: [], open: false, children: [] }] }]
    const bytes = await editDocument(doc, (e) => {
      const root = writeOutline(e, tree, e.pageRefs)
      if (root) e.catalog.set('Outlines', root)
    })
    expect(await outlineOf(bytes)).toEqual(['Début:3', '-Two:1'])
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text).not.toContain('Chapter 1')
    const out = await PdfDocument.load(bytes)
    expect(out.pages().length).toBe(4)
    expect(out.catalog().has('Lang')).toBe(true)
    expect(out.catalog().has('Dests')).toBe(true) // everything else in the catalog stays
  })

  test('an empty tree removes the bookmarks', async () => {
    const bytes = await editDocument(await PdfDocument.load(book()), (e) => void e.catalog.delete('Outlines'))
    expect(await outlineOf(bytes)).toEqual([])
    expect(new TextDecoder('latin1').decode(bytes)).not.toContain('Chapter')
  })
})
