import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfStream, decodeStream } from '@ream/pdf-core'
import { editContent, pageContentItems } from '../src/content-edit.ts'
import { pageChars } from '../src/textchars.ts'
import { assemble } from '../../pdf-core/test/helpers.ts'
import { makeTtf } from '../../pdf-core/test/ttf-helper.ts'
import { fakePlatform } from './helpers.ts'

const hex = (b: Uint8Array) => Array.from(b, (c) => c.toString(16).padStart(2, '0')).join('') + '>'
const stream = (dict: string, data: string) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`
const CONTENT = [
  'BT /F1 10 Tf 1 0 0 1 20 80 Tm (AA A) Tj ET',
  'BT /F1 10 Tf 1 0 0 1 20 69 Tm (A) Tj ET',
  'BT /F2 10 Tf 1 0 0 1 20 40 Tm (Hello) Tj ET',
  'q 40 0 0 20 120 10 cm /Im1 Do Q',
].join('\n')

/** a 200 x 100 page: two lines in an embedded subset (it has A, Á and the space), one in Helvetica, and a picture */
const pdf = (rotate = 0, content = CONTENT) =>
  PdfDocument.load(assemble([
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Rotate ${rotate} /Resources << /Font << /F1 5 0 R /F2 7 0 R >> /XObject << /Im1 8 0 R >> >> /Contents 4 0 R >>`],
    [4, stream('', content)],
    [5, `<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Test /FirstChar 32 /LastChar 255 /Widths [${Array(224).fill(600).join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>`],
    [6, '<< /Type /FontDescriptor /FontName /ABCDEF+Test /Flags 32 /FontFile2 9 0 R >>'],
    [7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
    [8, stream('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode', '00ff00ff>')],
    [9, stream('/Filter /ASCIIHexDecode', hex(makeTtf()))],
  ]).bytes)

const { platform } = fakePlatform()
const texts = async (doc: PdfDocument) => (await pageContentItems(doc, 0)).lines.map((l) => l.text)

describe('editing a page\'s own content', () => {
  test('lines of text, the letters each line\'s font can show again, and the pictures', async () => {
    const { lines, pictures } = await pageContentItems(await pdf(), 0)
    expect(lines.map((l) => l.text)).toEqual(['AA A', 'A', 'Hello'])
    // the subset has A, Á and the space and nothing else (its .notdef and the letters it lacks don't count)
    expect([...lines[0].letters].sort()).toEqual([' ', 'A', 'Á'])
    // Helvetica isn't embedded: the viewer has all of it
    expect(lines[2].letters).toContain('B')
    expect(lines[0].box.x0).toBeCloseTo(20)
    expect(lines[0].baseline[1]).toBeCloseTo(20)
    expect(lines[0].size).toBeCloseTo(10)
    expect(pictures).toEqual([{ id: 0, box: { x0: 120, y0: 70, x1: 160, y1: 90 } }])
  })

  test('a line changed in its own font, the lines around it untouched', async () => {
    const doc = await pdf()
    const out = await PdfDocument.load(await editContent(doc, new Map([[0, { lines: [{ id: 0, text: 'Á AA', own: true }, { id: 2, text: 'Hello Bob', own: true, dy: 10 }] }]]), platform))
    const { lines } = await pageContentItems(out, 0)
    expect(lines.map((l) => l.text).sort()).toEqual(['A', 'Hello Bob', 'Á AA'])
    const edited = lines.find((l) => l.text === 'Á AA')!
    expect(edited.baseline[0]).toBeCloseTo(20)
    expect(edited.baseline[1]).toBeCloseTo(20)
    expect(lines.find((l) => l.text === 'Hello Bob')!.baseline[1]).toBeCloseTo(70)
    // the text is real text, read like any other
    const all = (await pageChars(out, 0)).chars.map((c) => c.text).join('')
    expect(all).toContain('Hello')
    expect(all).not.toContain('AA A')
  })

  test("a letter the font lacks is refused; a line taken out is gone", async () => {
    const doc = await pdf()
    await expect(editContent(doc, new Map([[0, { lines: [{ id: 1, text: 'AB', own: true }] }]]), platform)).rejects.toThrow(/no "B"/)
    const out = await PdfDocument.load(await editContent(doc, new Map([[0, { lines: [{ id: 1, text: '', own: false }] }]]), platform))
    expect(await texts(out)).toEqual(['AA A', 'Hello'])
  })

  test('pictures move, resize and go, on an upright page and a turned one', async () => {
    for (const rotate of [0, 90]) {
      const doc = await pdf(rotate)
      const [before] = (await pageContentItems(doc, 0)).pictures
      const box = { x0: before.box.x0 + 5, y0: before.box.y0 + 3, x1: before.box.x0 + 5 + (before.box.x1 - before.box.x0) * 2, y1: before.box.y1 + 3 }
      const moved = await PdfDocument.load(await editContent(doc, new Map([[0, { pictures: [{ id: 0, box }] }]]), platform))
      const [after] = (await pageContentItems(moved, 0)).pictures
      for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(after.box[k]).toBeCloseTo(box[k])
      const gone = await PdfDocument.load(await editContent(doc, new Map([[0, { pictures: [{ id: 0, box: null }] }]]), platform))
      expect((await pageContentItems(gone, 0)).pictures).toEqual([])
    }
  })

  test('a moved picture comes out of the clip it was drawn in, and keeps its name when another area is erased', async () => {
    const clipped = CONTENT.replace('q 40 0 0 20 120 10 cm /Im1 Do Q', 'q 120 10 40 20 re W n 40 0 0 20 120 10 cm /Im1 Do Q')
    const doc = await pdf(0, clipped)
    const box = { x0: 20, y0: 70, x1: 60, y1: 90 }
    const out = await PdfDocument.load(await editContent(doc, new Map([[0, { pictures: [{ id: 0, box }], erase: [{ x0: 15, y0: 50, x1: 100, y1: 62 }] }]]), platform))
    const { lines, pictures } = await pageContentItems(out, 0)
    expect(lines.map((l) => l.text)).toEqual(['AA A', 'A'])
    expect(pictures.map((p) => [p.box.x0, p.box.y0].map(Math.round))).toEqual([[20, 70]])
    const xo = (out.resolve((out.resolve(out.pages()[0].dict.get('Resources')) as Map<string, unknown>).get('XObject') as never) as Map<string, unknown>)
    expect([...xo.keys()]).toContain('Im1')
  })

  test('an erased area loses its text and pictures; the rest stays', async () => {
    const doc = await pdf()
    // displayed: Hello sits on the baseline at y 60, the picture from 70 to 90
    const out = await PdfDocument.load(await editContent(doc, new Map([[0, { erase: [{ x0: 10, y0: 50, x1: 190, y1: 95 }] }]]), platform))
    const { lines, pictures } = await pageContentItems(out, 0)
    expect(lines.map((l) => l.text)).toEqual(['AA A', 'A'])
    expect(pictures).toEqual([])
  })

  test('a picture partly erased keeps its pixels and hides the erased part with a soft mask, not black', async () => {
    const out = await PdfDocument.load(await editContent(await pdf(), new Map([[0, { erase: [{ x0: 100, y0: 60, x1: 140, y1: 95 }] }]]), platform))
    const res = out.resolve(out.pages()[0].dict.get('Resources')) as Map<string, unknown>
    const xo = [...(out.resolve(res.get('XObject') as never) as Map<string, unknown>).values()].map((r) => out.resolve(r as never) as { dict: Map<string, unknown>; data: Uint8Array })
    const image = xo.find((x) => x.dict.get('SMask'))!
    expect(image.dict.get('Width')).toBe(2)
    const mask = out.resolve(image.dict.get('SMask') as never) as PdfStream
    // the left column (x 120 to 140) is under the area, the right one isn't
    expect([...(await decodeStream(mask))]).toEqual([0, 255, 0, 255])
  })
})
