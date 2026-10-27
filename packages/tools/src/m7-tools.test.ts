import { describe, expect, test } from 'vitest'
import type { FileData } from '@ream/core'
import { PdfDocument, extract, fillForm, merge, readForm, readOutline, type FontFaceInfo, type OutlineItem } from '@ream/pdf-core'
import { brokenXrefPdf, classicPdf, formPdf, pageTexts } from '../../pdf-core/test/helpers.ts'
import { run as bookmarks } from './bookmarks-pdf/run.ts'
import { run as organize } from './organize-pdf/run.ts'
import { duplicate, isOriginal, moveTo, original, removeAt, turn } from './organize-pdf/pages.ts'
import { run as repair } from './repair-pdf/run.ts'
import { run as toText } from './pdf-to-text/run.ts'
import { faceFor, run as watermark, type WatermarkOptions } from './watermark/run.ts'
import { makeTtf } from '../../pdf-core/test/ttf-helper.ts'
import { indent, insertAfter, move, outdent, remove, rows, siblings, update } from './bookmarks-pdf/tree.ts'

const ctx = { progress: () => {} }
const pdf = (n = 3, name = 'doc.pdf'): FileData => ({ name, type: 'application/pdf', bytes: classicPdf(Array.from({ length: n }, (_, i) => `P${i + 1}`)) })
const item = (title: string, page: number | null = 0, children: OutlineItem[] = []): OutlineItem => ({ title, page, fit: ['Fit'], open: false, children })
const names = (items: OutlineItem[]) => rows(items).map((r) => `${'-'.repeat(r.depth)}${r.item.title}`)

describe('bookmark tree editing', () => {
  const tree = () => [item('A', 0, [item('A1', 1), item('A2', 2)]), item('B', 1), item('C', 2)]

  test('rows come in display order with their paths', () => {
    expect(rows(tree()).map((r) => r.path.join('.'))).toEqual(['0', '0.0', '0.1', '1', '2'])
    expect(siblings(tree(), [0, 1])).toBe(2)
  })

  test('update, remove and insert at any level without touching the original', () => {
    const t = tree()
    expect(names(update(t, [0, 1], { title: 'X' }))).toEqual(['A', '-A1', '-X', 'B', 'C'])
    expect(names(remove(t, [0]))).toEqual(['B', 'C'])
    expect(names(insertAfter(t, [0, 0], item('N')))).toEqual(['A', '-A1', '-N', '-A2', 'B', 'C'])
    expect(names(insertAfter(t, null, item('N')))).toEqual(['A', '-A1', '-A2', 'B', 'C', 'N'])
    expect(names(t)).toEqual(['A', '-A1', '-A2', 'B', 'C'])
  })

  test('move stays among siblings; indent and outdent change the level', () => {
    expect(names(move(tree(), [1], -1))).toEqual(['B', 'A', '-A1', '-A2', 'C'])
    expect(names(move(tree(), [0, 1], -1))).toEqual(['A', '-A2', '-A1', 'B', 'C'])
    expect(names(move(tree(), [2], 1))).toEqual(['A', '-A1', '-A2', 'B', 'C']) // already last
    expect(names(indent(tree(), [1]))).toEqual(['A', '-A1', '-A2', '-B', 'C'])
    expect(indent(tree(), [1])[0].open).toBe(true)
    expect(names(indent(tree(), [0]))).toEqual(['A', '-A1', '-A2', 'B', 'C']) // nothing above to join
    // taking A1 out one level leaves it after A, with the entry that followed it (A2) inside it
    expect(names(outdent(tree(), [0, 0]))).toEqual(['A', 'A1', '-A2', 'B', 'C'])
    expect(names(outdent(tree(), [1]))).toEqual(['A', '-A1', '-A2', 'B', 'C'])
  })
})

describe('bookmarks-pdf', () => {
  const read = async (f: FileData) => readOutline(await PdfDocument.load(f.bytes))

  test('adds bookmarks to a file that has none, keeping its pages', async () => {
    const [out] = await bookmarks([pdf(3)], { items: [item('Start', 0, [item('Middle', 1)]), item('End', 2)] }, ctx)
    expect(out.name).toBe('doc-bookmarks.pdf')
    expect(rows(await read(out)).map((r) => `${r.depth}:${r.item.title}:${r.item.page}`)).toEqual(['0:Start:0', '1:Middle:1', '0:End:2'])
    expect((await PdfDocument.load(out.bytes)).pages().length).toBe(3)
  })

  test('replaces existing bookmarks, and an empty list removes them', async () => {
    const [first] = await bookmarks([pdf(3)], { items: [item('Old', 0)] }, ctx)
    const [second] = await bookmarks([first], { items: [item('New', 1)] }, ctx)
    expect((await read(second)).map((i) => i.title)).toEqual(['New'])
    expect(new TextDecoder('latin1').decode(second.bytes)).not.toContain('Old')
    const [none] = await bookmarks([second], { items: [] }, ctx)
    expect(await read(none)).toEqual([])
  })

  test('bookmarks survive the page tools: merge, then extract', async () => {
    const [a] = await bookmarks([pdf(2, 'a.pdf')], { items: [item('Alpha', 1)] }, ctx)
    const [b] = await bookmarks([pdf(2, 'b.pdf')], { items: [item('Beta', 0)] }, ctx)
    const joined = merge([{ doc: await PdfDocument.load(a.bytes) }, { doc: await PdfDocument.load(b.bytes) }])
    expect((await read({ ...a, bytes: joined })).map((i) => `${i.title}:${i.page}`)).toEqual(['Alpha:1', 'Beta:2'])
    const part = extract(await PdfDocument.load(joined), [2, 3])
    expect((await read({ ...a, bytes: part })).map((i) => `${i.title}:${i.page}`)).toEqual(['Beta:0'])
  })

  test('mistakes are explained', async () => {
    await expect(bookmarks([pdf(2)], { items: null }, ctx)).rejects.toThrow('still being read')
    await expect(bookmarks([pdf(2)], { items: [item('  ')] }, ctx)).rejects.toThrow('Give every bookmark a name')
    await expect(bookmarks([pdf(2)], { items: [item('Far', 5)] }, ctx)).rejects.toThrow('points at page 6, but the file has 2 pages')
  })
})

describe('organize-pdf', () => {
  const abcd = () => pdf(4)
  const texts = async (f: FileData) => pageTexts(f.bytes)
  const rotations = async (f: FileData) => {
    const doc = await PdfDocument.load(f.bytes)
    return doc.pages().map((p) => doc.pageBox(p).rotate)
  }

  test('page list helpers', () => {
    expect(original(3)).toEqual([{ src: 0, rotate: 0 }, { src: 1, rotate: 0 }, { src: 2, rotate: 0 }])
    expect(moveTo([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4])
    expect(moveTo([1, 2, 3], 2, 0)).toEqual([3, 1, 2])
    expect(moveTo([1, 2, 3], 1, 9)).toEqual([1, 2, 3])
    expect(duplicate(original(2), 0).map((e) => e.src)).toEqual([0, 0, 1])
    expect(removeAt([1, 2, 3], 1)).toEqual([1, 3])
    expect(turn({ src: 0, rotate: 0 }, -90).rotate).toBe(270)
    expect(turn({ src: 0, rotate: 270 }, 90).rotate).toBe(0)
    expect(isOriginal(original(3), 3)).toBe(true)
    expect(isOriginal(original(3), 4)).toBe(false)
  })

  test('reorders, turns, copies and deletes in one go', async () => {
    const [out] = await organize([abcd()], { pages: [{ src: 3, rotate: 0 }, { src: 0, rotate: 90 }, { src: 0, rotate: 180 }, { src: 1, rotate: 0 }] }, ctx)
    expect(out.name).toBe('doc-organized.pdf')
    expect(await texts(out)).toEqual(['P4', 'P1', 'P1', 'P2'])
    expect(await rotations(out)).toEqual([0, 90, 180, 0])
  })

  test('a page used several times is stored once', async () => {
    const many = (await organize([pdf(2)], { pages: [1, 1, 1, 1, 1, 1].map((src) => ({ src, rotate: 0 as const })) }, ctx))[0]
    expect(new TextDecoder('latin1').decode(many.bytes).match(/\(P2\)/g)).toHaveLength(1) // the content stream, once, for six pages
    expect((await PdfDocument.load(many.bytes)).pages().length).toBe(6)
  })

  test('bookmarks follow the pages that moved', async () => {
    const [marked] = await bookmarks([abcd()], { items: [item('One', 0), item('Three', 2), item('Four', 3)] }, ctx)
    const [out] = await organize([marked], { pages: [{ src: 3, rotate: 0 }, { src: 2, rotate: 0 }, { src: 0, rotate: 0 }] }, ctx)
    expect(readOutline(await PdfDocument.load(out.bytes)).map((i) => `${i.title}:${i.page}`)).toEqual(['One:2', 'Three:1', 'Four:0'])
  })

  test('mistakes are explained', async () => {
    await expect(organize([abcd()], { pages: null }, ctx)).rejects.toThrow('still being read')
    await expect(organize([abcd()], { pages: [] }, ctx)).rejects.toThrow('at least one page')
    await expect(organize([abcd()], { pages: original(4) }, ctx)).rejects.toThrow('Nothing has changed')
    await expect(organize([abcd()], { pages: [{ src: 9, rotate: 0 }] }, ctx)).rejects.toThrow("doesn't match")
  })
})

describe('repair-pdf', () => {
  test('saves a damaged file as a clean copy', async () => {
    const [out] = await repair([{ name: 'bad.pdf', type: 'application/pdf', bytes: brokenXrefPdf(['A', 'B']) }], {}, ctx)
    expect(out.name).toBe('bad-repaired.pdf')
    expect(await pageTexts(out.bytes)).toEqual(['A', 'B'])
    expect((await PdfDocument.load(out.bytes)).rebuilt).toBe(false)
  })

  test('says so when nothing can be recovered', async () => {
    await expect(repair([{ name: 'x.pdf', type: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4\nnothing here') }], {}, ctx)).rejects.toThrow(/too badly damaged/)
  })
})

describe('pdf-to-text', () => {
  const decode = (f: FileData) => new TextDecoder().decode(f.bytes)

  test('plain text and Markdown files, one page or several', async () => {
    const [txt] = await toText([pdf(3)], { format: 'text', pages: '' }, ctx)
    expect(txt).toMatchObject({ name: 'doc.txt', type: 'text/plain' })
    expect(decode(txt)).toBe('P1\n\nP2\n\nP3\n')
    const [md] = await toText([pdf(3)], { format: 'markdown', pages: '2-3' }, ctx)
    expect(md).toMatchObject({ name: 'doc.md', type: 'text/markdown' })
    expect(decode(md)).toBe('P2\n\n---\n\nP3\n')
  })

  test('says why when there is no text', async () => {
    const blank: FileData = { name: 'scan.pdf', type: 'application/pdf', bytes: classicPdf(['']) }
    await expect(toText([blank], { format: 'text', pages: '' }, ctx)).rejects.toThrow(/OCR/)
  })
})

describe('watermark with an uploaded font', () => {
  const o = (patch: Partial<WatermarkOptions> = {}): WatermarkOptions => ({ text: 'AЖ', size: 40, bold: false, italic: false, color: '#888888', opacity: 50, angle: 0, layout: 'single', spot: 'mc', spacing: 40, layer: 'over', pages: '', fontFile: makeTtf(), fontName: 'test.ttf', ...patch })

  test('draws the text with the embedded font, on every page, with the font stored once', async () => {
    const [out] = await watermark([pdf(3)], o(), ctx)
    const doc = await PdfDocument.load(out.bytes)
    const content = (await pageTexts(out.bytes)).length
    expect(content).toBe(3)
    const raw = new TextDecoder('latin1').decode(out.bytes)
    expect(raw).toContain('/ReamEmbWm 40 Tf')
    expect(raw).toContain('<00020003> Tj')
    expect([...doc.objects.values()].filter((x) => x instanceof Map && x.get('Subtype')?.constructor.name === 'PdfName' && (x.get('Subtype') as { value: string }).value === 'Type0')).toHaveLength(1)
  })

  test('a letter the font lacks, and a file that is not a font, are explained', async () => {
    await expect(watermark([pdf(1)], o({ text: 'Aש' }), ctx)).rejects.toThrow('no glyph for')
    await expect(watermark([pdf(1)], o({ fontFile: new TextEncoder().encode('not a font at all, really') }), ctx)).rejects.toThrow("isn't a TrueType or OpenType font")
  })

  test('bold and italic are drawn when the font has no face for them: an outline in the text colour, and a slant', async () => {
    const raw = async (patch: Partial<WatermarkOptions>) => new TextDecoder('latin1').decode((await watermark([pdf(1)], o(patch), ctx))[0].bytes)
    const plain = await raw({})
    expect(plain).not.toContain(' Tr ')
    expect(plain).toMatch(/1 0 0 1 [-\d.]+ [-\d.]+ Tm <00020003> Tj/)
    // 3% of the 40 pt size, filled and stroked in the watermark's grey
    expect(await raw({ bold: true })).toContain('/ReamEmbWm 40 Tf 2 Tr 1.2 w 1 j 0.533 0.533 0.533 RG')
    expect(await raw({ italic: true })).toMatch(/1 0 0\.2126 1 [-\d.]+ [-\d.]+ Tm <00020003> Tj/)
  })

  test('the file\'s own bold or italic face is used when it has one, and only what is missing is drawn', () => {
    const face = (style: string, embeddable = true): FontFaceInfo => ({ family: 'Sans', style, postscript: `Sans-${style.replace(' ', '')}`, embeddable })
    const all = [face('Regular'), face('Bold'), face('Italic'), face('Bold Italic')]
    expect(faceFor(all, true, false)).toEqual({ face: 'Sans-Bold', fakeBold: false, fakeItalic: false })
    expect(faceFor(all, true, true)).toEqual({ face: 'Sans-BoldItalic', fakeBold: false, fakeItalic: false })
    expect(faceFor(all, false, false)).toEqual({ face: 'Sans-Regular', fakeBold: false, fakeItalic: false })
    // no bold italic: the bold face, slanted
    expect(faceFor([face('Regular'), face('Bold')], true, true)).toEqual({ face: 'Sans-Bold', fakeBold: false, fakeItalic: true })
    // a bold face whose licence forbids embedding is passed over for the regular one, drawn bold
    expect(faceFor([face('Regular'), face('Bold', false)], true, false)).toEqual({ face: 'Sans-Regular', fakeBold: true, fakeItalic: false })
    // a file that only has a bold face stays bold, and gets nothing added
    expect(faceFor([face('Black')], false, false)).toEqual({ face: 'Sans-Black', fakeBold: false, fakeItalic: false })
    // a big family: the faces named Regular and Bold, not Medium or Demi Bold
    const family = ['Bold', 'Bold Italic', 'Demi Bold', 'Italic', 'Medium', 'Regular', 'Heavy', 'Ultra Light'].map((st) => face(st))
    expect(faceFor(family, false, false).face).toBe('Sans-Regular')
    expect(faceFor(family, true, false).face).toBe('Sans-Bold')
    expect(faceFor(family, false, true).face).toBe('Sans-Italic')
    // a font without names (the test font) is its first face, with everything drawn
    expect(faceFor([], true, true)).toEqual({ face: 0, fakeBold: true, fakeItalic: true })
  })

  test('without a font file it is Helvetica and Latin only, as before', async () => {
    await expect(watermark([pdf(1)], o({ fontFile: null, text: 'Aж' }), ctx)).rejects.toThrow("can't be drawn yet")
  })
})
