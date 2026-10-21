import { describe, expect, test } from 'vitest'
import type { FileData } from '@ream/core'
import { PdfDocument, PdfStream, decodeStream, readForm, type PdfDict } from '@ream/pdf-core'
import { createImage, encodePng } from '@ream/image-core'
import { pageChars } from '@ream/pdf-render'
import { assemble, formPdf } from '../../../pdf-core/test/helpers.ts'
import { nodeFonts } from '../fonts/node.ts'
import { wrapLines } from './layout.ts'
import { run } from './run.ts'
import { defaultOptions, type Item } from './items.ts'

const ctx = { progress: () => {} }
const pdfOf = (bytes: Uint8Array, name = 'doc.pdf'): FileData => ({ name, type: 'application/pdf', bytes })
const stream = (data: string) => `<< /Length ${data.length} >>\nstream\n${data}\nendstream`

/** one page, 200 x 100 points, with its own text in Helvetica; `extra` goes into the page dictionary */
const page = (extra = '', inheritResources = false) =>
  assemble([
    [1, '<< /Type /Catalog /Pages 2 0 R /Outlines 9 0 R >>'],
    [2, `<< /Type /Pages /Kids [3 0 R] /Count 1 ${inheritResources ? '/Resources << /Font << /F1 5 0 R >> >>' : ''} >>`],
    [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] ${inheritResources ? '' : '/Resources << /Font << /F1 5 0 R >> >>'} /Contents 4 0 R ${extra} >>`],
    [4, stream('BT /F1 10 Tf 10 80 Td (Original) Tj ET')],
    [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    [9, '<< /Type /Outlines /First 10 0 R /Last 10 0 R /Count 1 >>'],
    [10, '<< /Title (Kept) /Parent 9 0 R /Dest [3 0 R /Fit] >>'],
  ]).bytes

const text = (over: Partial<Extract<Item, { kind: 'text' }>> = {}): Item => ({ id: 't', page: 0, kind: 'text', box: { x: 0.5, y: 0.5, w: 0.4, h: 0.2 }, text: 'Added', font: 'Arial', size: 12, colour: '#000000', bold: false, italic: false, align: 'left', spacing: 1.2, opacity: 1, ...over })
const edit = async (bytes: Uint8Array, items: Item[], more: Partial<typeof defaultOptions> = {}) => PdfDocument.load((await run([pdfOf(bytes)], { ...defaultOptions, items, ...more }, ctx, nodeFonts))[0].bytes)
const word = async (doc: PdfDocument, w: string) => {
  const chars = (await pageChars(doc, 0)).chars
  const all = chars.map((c) => c.text).join('')
  const i = all.indexOf(w)
  return i < 0 ? null : chars[i]
}
const annots = (doc: PdfDocument) => (doc.resolve(doc.pages()[0].dict.get('Annots')) as unknown[] ?? []).map((a) => doc.resolve(a as never) as PdfDict)

describe('lines', () => {
  const mono = (s: string) => s.length // every letter one unit wide
  test('words go on the line while they fit; the user\'s line breaks stay; long words break between letters', () => {
    expect(wrapLines('one two three', 7, mono)).toEqual(['one two', 'three'])
    expect(wrapLines('a\nb c', 10, mono)).toEqual(['a', 'b c'])
    expect(wrapLines('abcdefghij xy', 4, mono)).toEqual(['abcd', 'efgh', 'ij', 'xy'])
    expect(wrapLines('', 4, mono)).toEqual([''])
    expect(wrapLines('fits   ', 4, mono)).toEqual(['fits'])
  })
})

describe('edit-pdf: drawn into the page', () => {
  test('text lands where it was placed, real and selectable; the page keeps its own text and bookmarks', async () => {
    const out = await edit(page(), [text()])
    const a = await word(out, 'Added')
    expect(a).not.toBeNull()
    expect(a!.x0).toBeCloseTo(100, 0)
    // the first baseline sits under the top of the box by the line box rule (about one size)
    expect(a!.y0).toBeGreaterThan(50)
    expect(a!.y0).toBeLessThan(65)
    expect(await word(out, 'Original')).not.toBeNull()
    const outline = out.resolve(out.catalog().get('Outlines')) as PdfDict
    expect(outline.has('First')).toBe(true)
  })

  test('on a page turned a quarter, items are placed on the page as it is shown', async () => {
    const out = await edit(page('/Rotate 90'), [text({ box: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 } })])
    // displayed 100 wide and 200 tall: the text starts 10 points in from the left as shown
    const a = await word(out, 'Added')
    expect(a!.x0).toBeCloseTo(10, 0)
    expect(a!.y0).toBeGreaterThan(20)
    expect(a!.y0).toBeLessThan(40)
  })

  test('a page whose resources come from the page tree keeps drawing its own text', async () => {
    const out = await edit(page('', true), [text()])
    expect(await word(out, 'Original')).not.toBeNull()
    expect(await word(out, 'Added')).not.toBeNull()
  })

  test('alignment and wrapping follow the font\'s own widths', async () => {
    const out = await edit(page(), [text({ text: 'Right', align: 'right', box: { x: 0, y: 0, w: 1, h: 0.3 } })])
    const r = (await pageChars(out, 0)).chars.filter((c) => 'Right'.includes(c.text)).slice(-5)
    expect(r[r.length - 1].x1).toBeCloseTo(200, 0)
  })

  test('letters the font lacks are refused with a message', async () => {
    await expect(edit(page(), [text({ text: '漢字' })])).rejects.toThrow(/doesn't have 漢 字/)
  })

  test('pictures, shapes, lines, drawings and whiteout go into one form drawn over the page', async () => {
    const img = createImage(2, 2)
    img.data.fill(200)
    const png = await encodePng(img)
    const items: Item[] = [
      { id: 'i', page: 0, kind: 'image', box: { x: 0, y: 0, w: 0.2, h: 0.4 }, data: png, type: 'image/png', turns: 1, opacity: 1 },
      { id: 's', page: 0, kind: 'shape', shape: 'ellipse', box: { x: 0.3, y: 0.1, w: 0.2, h: 0.4 }, fill: '#ff0000', stroke: '#000000', width: 2, opacity: 0.5 },
      { id: 'l', page: 0, kind: 'line', from: { x: 0.6, y: 0.2 }, to: { x: 0.9, y: 0.2 }, colour: '#0000ff', width: 2, arrow: 'end', opacity: 1 },
      { id: 'd', page: 0, kind: 'draw', strokes: [[{ x: 0.1, y: 0.8 }, { x: 0.2, y: 0.9 }, { x: 0.3, y: 0.8 }]], colour: '#ffff00', width: 10, highlighter: true },
      { id: 'w', page: 0, kind: 'whiteout', box: { x: 0, y: 0.7, w: 0.1, h: 0.1 }, colour: '#ffffff' },
    ]
    const out = await edit(page(), items)
    const res = out.resolve(out.pages()[0].dict.get('Resources')) as PdfDict
    const form = [...(out.resolve(res.get('XObject')) as PdfDict).values()].map((r) => out.resolve(r) as PdfStream)[0]
    expect(form.dict.get('Matrix')).toEqual([1, 0, 0, 1, 0, 0])
    const body = new TextDecoder().decode(await decodeStream(form))
    expect(body).toMatch(/ Do Q/) // the picture
    expect(body).toMatch(/ c .* c .* c .* c h? ?B/s) // the ellipse, filled and outlined
    expect(body).toMatch(/1 J 1 j/) // the freehand stroke's round ends
    const states = [...(out.resolve((out.resolve(form.dict.get('Resources')) as PdfDict).get('ExtGState')) as PdfDict).values()].map((g) => out.resolve(g) as PdfDict)
    expect(states.some((g) => (g.get('BM') as { value?: string })?.value === 'Multiply')).toBe(true)
    expect(states.some((g) => g.get('ca') === 0.5)).toBe(true)
    // the page's own content still comes first, wrapped so its state can't move the drawing
    const contents = (out.resolve(out.pages()[0].dict.get('Contents')) as unknown[]).map((c) => out.resolve(c as never) as PdfStream)
    expect(new TextDecoder().decode(await decodeStream(contents[contents.length - 1]))).toMatch(/^Q\n\/ReamEdit0 Do/)
  })

  test('every page: an item marked so is drawn on each page', async () => {
    const two = assemble([
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'],
      [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>'],
      [4, stream('')],
      [5, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>'],
    ]).bytes
    const out = await edit(two, [{ ...text({ text: 'Header' }), everyPage: true }])
    for (const i of [0, 1]) expect((await pageChars(out, i)).chars.map((c) => c.text).join('')).toBe('Header')
  })
})

describe('edit-pdf: comments', () => {
  test('highlight, underline and strike-out carry QuadPoints and a picture; notes have a pop-up; links open or go to a page', async () => {
    const quad = [{ x: 0.05, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.05, y: 0.25 }, { x: 0.3, y: 0.25 }] as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
    const out = await edit(page(), [
      { id: 'h', page: 0, kind: 'markup', type: 'highlight', quads: [quad], colour: '#ffff00', text: 'Original' },
      { id: 'u', page: 0, kind: 'markup', type: 'underline', quads: [quad], colour: '#0000ff', text: 'Original' },
      { id: 'n', page: 0, kind: 'note', at: { x: 0.8, y: 0.2 }, text: 'Check this', colour: '#ffcc00' },
      { id: 'k', page: 0, kind: 'link', box: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, url: 'https://example.com', target: null },
      { id: 'p', page: 0, kind: 'link', box: { x: 0.1, y: 0.5, w: 0.2, h: 0.2 }, url: '', target: 0 },
    ])
    const a = annots(out)
    const kinds = a.map((d) => (d.get('Subtype') as { value: string }).value)
    expect(kinds).toEqual(['Highlight', 'Underline', 'Text', 'Popup', 'Link', 'Link'])
    // user space of a 200 x 100 page: x from 10 to 60, y from 75 up to 90
    expect(a[0].get('QuadPoints')).toEqual([10, 90, 60, 90, 10, 75, 60, 75])
    expect(a[0].has('AP')).toBe(true)
    const action = out.resolve(a[4].get('A') as never) as PdfDict
    expect(new TextDecoder().decode((action.get('URI') as { bytes: Uint8Array }).bytes)).toBe('https://example.com')
    const go = out.resolve(a[5].get('A') as never) as PdfDict
    expect((go.get('S') as { value: string }).value).toBe('GoTo')
  })

  test('flattening comments bakes them into the page; form fields of the file are kept either way', async () => {
    const form = formPdf()
    const kept = await edit(form, [text()])
    expect(readForm(kept).fields.length).toBe(readForm(await PdfDocument.load(form)).fields.length)
    const flat = await edit(page(), [{ id: 'n', page: 0, kind: 'note', at: { x: 0.8, y: 0.2 }, text: 'x', colour: '#ffcc00' }], { flattenComments: true })
    expect(annots(flat).filter((d) => (d.get('Subtype') as { value: string }).value === 'Text')).toEqual([])
  })

  test('nothing added is a clear error', async () => {
    await expect(run([pdfOf(page())], defaultOptions, ctx, nodeFonts)).rejects.toThrow(/Change something first/)
  })
})

describe('editing on the page', async () => {
  const { boxOf, moved, pickText, resized, snap } = await import('./geometry.ts')
  test('moving and resizing; pictures keep their shape from a corner', () => {
    const line: Item = { id: 'l', page: 0, kind: 'line', from: { x: 0.1, y: 0.2 }, to: { x: 0.3, y: 0.1 }, colour: '#000000', width: 1, arrow: 'none', opacity: 1 }
    expect(boxOf(line)).toEqual({ x: 0.1, y: 0.1, w: 0.19999999999999998, h: 0.1 })
    expect((moved(line, 0.1, 0) as typeof line).from).toEqual({ x: 0.2, y: 0.2 })
    const wide = resized({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 'e', { x: 0.5, y: 0.9 })
    expect([wide.x, wide.y, wide.w, wide.h].map((v) => +v.toFixed(6))).toEqual([0.1, 0.1, 0.4, 0.2])
    const kept = resized({ x: 0, y: 0, w: 0.2, h: 0.1 }, 'se', { x: 0.4, y: 0.1 }, true)
    expect(kept.w / kept.h).toBeCloseTo(2)
    // a side can't pass the opposite side
    expect(resized({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 'w', { x: 0.9, y: 0 }).w).toBeCloseTo(0.01)
  })

  test('snapping to the page middle and to other items, with guides', () => {
    const s = snap({ x: 0.395, y: 0.2, w: 0.2, h: 0.1 }, [{ x: 0.7, y: 0.25, w: 0.1, h: 0.1 }], { x: 0.01, y: 0.01 })
    expect(s.dx).toBeCloseTo(0.005) // its middle onto the page's middle
    expect(s.dy).toBe(0)
    expect(s.guides.x).toContain(0.5)
    expect(snap({ x: 0.3, y: 0.3, w: 0.1, h: 0.1 }, [], { x: 0.01, y: 0.01 })).toEqual({ dx: 0, dy: 0, guides: { x: [], y: [] } })
  })

  test('picking text for markup: the letters under the box, a quad per line, in reading order', () => {
    const ch = (text: string, x: number, line: number) => ({ text, x0: x, x1: x + 0.02, y0: 0.1 + line * 0.05, y1: 0.13 + line * 0.05 })
    const chars = [ch('H', 0.1, 0), ch('i', 0.12, 0), ch(' ', 0.14, 0), ch('y', 0.16, 0), ch('o', 0.1, 1), ch('u', 0.12, 1), ch('z', 0.5, 2)]
    const { quads, text } = pickText(chars, { x: 0.09, y: 0.09, w: 0.1, h: 0.1 })
    expect(text).toBe('Hiy ou')
    expect(quads).toHaveLength(2)
    expect(quads[0][0]).toEqual({ x: 0.1, y: 0.1 })
    expect(quads[0][3].x).toBeCloseTo(0.18)
  })
})
