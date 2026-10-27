import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfStream, PdfString, decodeStream, scanContent } from '@ream/pdf-core'
import { displayedArea, pageChars, redactPdf } from '../src/index.ts'
import type { Box } from '../src/bounds.ts'
import { cutFill, cutStroke, flattenPath, type Pt } from '../src/redact-paths.ts'
import { fakePlatform, hex, onePage, stream } from './helpers.ts'

const HELV = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 126 /Widths [' + Array(95).fill(500).join(' ') + '] >>'
const platform = fakePlatform().platform
const latin = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('')

async function redacted(doc: PdfDocument, areas: Box[], hidden = false, page = 0) {
  return PdfDocument.load(await redactPdf(doc, new Map([[page, areas]]), { platform, hidden }))
}

/** every stream decoded and every string, as text: what an attacker could read out of the file */
async function everything(doc: PdfDocument): Promise<string> {
  let all = ''
  const seen = new Set<unknown>()
  const walk = async (o: unknown): Promise<void> => {
    if (seen.has(o)) return
    seen.add(o)
    if (o instanceof PdfStream) {
      all += latin(await decodeStream(o).catch(() => o.data)) + '\n'
      for (const v of o.dict.values()) await walk(v)
    } else if (o instanceof PdfString) all += latin(o.bytes) + '\n'
    else if (Array.isArray(o)) for (const v of o) await walk(v)
    else if (o instanceof Map) for (const v of o.values()) await walk(v)
  }
  for (const o of doc.objects.values()) await walk(o)
  return all
}

const pageText = async (doc: PdfDocument, page = 0) => (await pageChars(doc, page)).chars.map((c) => c.text).join('')

describe('letters', () => {
  test('the letters under an area are removed and the ones after it keep their place', async () => {
    const doc = await onePage({ content: 'BT /F1 10 Tf 10 50 Td (Hello SECRET world) Tj ET', resources: '/Font << /F1 10 0 R >>', objects: { 10: HELV } })
    // each letter is 5 pt wide: SECRET runs from x 40 to 70
    const out = await redacted(doc, [[41, 45, 69, 60]])
    expect(await pageText(out)).toBe('Hello  world')
    const w = (await pageChars(out, 0)).chars.find((c) => c.text === 'w')!
    expect(w.x0).toBeCloseTo(75)
    expect(await everything(out)).not.toMatch(/SECRET|534543524554/i)
    // the black box goes over the area
    expect(latin(await decodeStream(out.resolve(out.pages()[0].dict.get('Contents')) as PdfStream))).toContain('0 g 41 45 28 15 re f')
  })

  test('TJ arrays keep their own moves; two-byte codes of a CID font are cut on code boundaries', async () => {
    const doc = await onePage({
      content: 'BT /F1 10 Tf 10 50 Td [<00010002> -500 <0003>] TJ ET',
      resources: '/Font << /F1 10 0 R >>',
      objects: {
        10: '<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [12 0 R] /ToUnicode 11 0 R >>',
        11: stream('', '1 begincodespacerange <0000> <FFFF> endcodespacerange 3 beginbfchar <0001> <0041> <0002> <0042> <0003> <0043> endbfchar'),
        12: '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /DW 1000 >>',
      },
    })
    // A at 10-20, B at 20-30, then a move of 5, C at 35-45
    const out = await redacted(doc, [[21, 40, 29, 60]])
    expect(await pageText(out)).toBe('AC')
    const ops = scanContent(await decodeStream(out.resolve(out.pages()[0].dict.get('Contents')) as PdfStream))
    const tj = ops.find((o) => o.op === 'TJ')!
    const items = tj.args[0] as unknown[]
    expect((items[0] as PdfString).bytes).toEqual(Uint8Array.of(0, 1))
    expect(items[1]).toBe(-1500) // B's 1000 and the original 500
    expect((await pageChars(out, 0)).chars.find((c) => c.text === 'C')!.x0).toBeCloseTo(35)
  })
})

describe('shapes are cut at the edge of the area', () => {
  const area = (poly: Pt[]) => Math.abs(poly.reduce((a, p, i) => a + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0) / 2)
  const square: Pt[] = [[40, 40], [60, 40], [60, 60], [40, 60]]
  const strictlyInside = (p: Pt) => p[0] > 40 + 1e-6 && p[0] < 60 - 1e-6 && p[1] > 40 + 1e-6 && p[1] < 60 - 1e-6

  test('a fill keeps exactly what is outside, without overlapping pieces', () => {
    const pieces = cutFill(flattenPath([{ op: 're', args: [10, 10, 80, 80] }], 1), [square])
    expect(pieces.reduce((n, p) => n + area(p), 0)).toBeCloseTo(80 * 80 - 20 * 20)
    expect(pieces.flat().some(strictlyInside)).toBe(false)
  })

  test('a curve crossing the area has no point left inside it', () => {
    const circle = flattenPath([{ op: 'm', args: [50, 20] }, { op: 'c', args: [70, 20, 80, 30, 80, 50] }, { op: 'c', args: [80, 70, 70, 80, 50, 80] }, { op: 'h', args: [] }], 1)
    const pieces = cutFill(circle, [square])
    expect(pieces.length).toBeGreaterThan(0)
    expect(pieces.flat().some(strictlyInside)).toBe(false)
  })

  test('a stroke keeps the parts of the line outside the area', () => {
    const lines = cutStroke(flattenPath([{ op: 'm', args: [0, 50] }, { op: 'l', args: [100, 50] }], 1), [square])
    expect(lines.map((l) => l.pts)).toEqual([[[0, 50], [40, 50]], [[60, 50], [100, 50]]])
  })

  test('in a page: paths are cut in their own space (cm), clips keep their geometry, paths elsewhere are untouched', async () => {
    const doc = await onePage({ content: 'q 2 0 0 2 0 0 cm 5 5 40 40 re f Q 0 0 5 5 re f 0 0 100 100 re W n 0 50 m 100 50 l S' })
    const out = await redacted(doc, [[40, 40, 60, 60]])
    const ops = scanContent(await decodeStream(out.resolve(out.pages()[0].dict.get('Contents')) as PdfStream))
    // the scaled square, in its own space: 40 x 40 less the 10 x 10 under the area
    const pts: Pt[] = []
    for (const o of ops) if (o.op === 'm' || o.op === 'l') pts.push(o.args as Pt)
    expect(pts.filter((p) => p[0] > 20 && p[0] < 30 && p[1] > 20 && p[1] < 30)).toEqual([])
    // the small square away from the area and the clip-only path are left as they were; the box over the area is added
    expect(ops.filter((o) => o.op === 're').map((o) => o.args)).toEqual([[0, 0, 5, 5], [0, 0, 100, 100], [40, 40, 20, 20]])
    expect(ops.some((o) => o.op === 'W')).toBe(true)
    expect(ops.some((o) => o.op === 'S')).toBe(true)
  })
})

describe('pictures', () => {
  const gray = (v: number) => hex(...new Array(16).fill(v))
  const image = (extra = '') => stream(`/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode ${extra}`, gray(200))

  test('the pixels under the area are wiped and the rest is untouched; the same picture on another page stays as it was', async () => {
    const doc = await PdfDocument.load(
      (await import('../../pdf-core/test/helpers.ts')).assemble([
        [1, '<< /Type /Catalog /Pages 2 0 R >>'],
        [2, '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'],
        [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im 10 0 R >> >> /Contents 4 0 R >>'],
        [4, stream('', 'q 100 0 0 100 0 0 cm /Im Do Q')],
        [5, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im 10 0 R >> >> /Contents 4 0 R >>'],
        [10, image()],
      ]).bytes,
    )
    const out = await redacted(doc, [[0, 0, 50, 50]])
    const used = (page: number) => {
      const res = out.resolve(out.pages()[page].dict.get('Resources')) as Map<string, unknown>
      const xo = out.resolve(res.get('XObject') as never) as Map<string, unknown>
      return [...xo.values()].map((r) => out.resolve(r as never) as PdfStream)
    }
    const page1 = scanContent(await decodeStream(out.resolve(out.pages()[0].dict.get('Contents')) as PdfStream))
    const name = (page1.find((o) => o.op === 'Do')!.args[0] as { value: string }).value
    const wiped = (out.resolve(out.resolve((out.resolve(out.pages()[0].dict.get('Resources')) as Map<string, never>).get('XObject')) as never) as Map<string, never>).get(name)
    const px = await decodeStream(out.resolve(wiped) as PdfStream)
    // rows from the top: the bottom two rows' left halves are under the area
    expect(Array.from(px)).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 0, 0, 200, 200, 0, 0, 200, 200])
    const other = used(1)
    expect(Array.from(await decodeStream(other[0]))).toEqual(new Array(16).fill(200))
  })

  test('an inline image becomes an image object with the pixels wiped', async () => {
    const doc = await onePage({ content: `q 100 0 0 100 0 0 cm BI /W 4 /H 4 /CS /G /BPC 8 /F /AHx ID ${gray(9)} EI Q` })
    const out = await redacted(doc, [[50, 50, 100, 100]])
    const ops = scanContent(await decodeStream(out.resolve(out.pages()[0].dict.get('Contents')) as PdfStream))
    expect(ops.some((o) => o.op === 'BI')).toBe(false)
    const res = out.resolve(out.pages()[0].dict.get('Resources')) as Map<string, never>
    const img = [...(out.resolve(res.get('XObject')) as Map<string, never>).values()].map((r) => out.resolve(r) as PdfStream)[0]
    expect(Array.from(await decodeStream(img))).toEqual([9, 9, 0, 0, 9, 9, 0, 0, 9, 9, 9, 9, 9, 9, 9, 9])
  })
})

describe('forms, annotations and hidden data', () => {
  test('a form XObject reaching into the area is redacted as a copy; covered annotations and fields go with their values', async () => {
    const doc = await onePage({
      content: '/Fm Do',
      resources: '/XObject << /Fm 11 0 R >>',
      pageExtra: '/Annots [12 0 R 13 0 R 14 0 R]',
      objects: {
        10: HELV,
        11: stream('/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /Font << /F1 10 0 R >> >>', 'BT /F1 10 Tf 10 50 Td (SECRET) Tj ET'),
        12: '<< /Type /Annot /Subtype /Link /Rect [10 45 40 60] /URI (SECRET) >>',
        13: '<< /Type /Annot /Subtype /Widget /FT /Tx /T (f) /V (SECRET) /Rect [50 50 60 60] >>',
        14: '<< /Type /Annot /Subtype /Widget /FT /Tx /T (g) /V (kept) /Rect [80 80 90 90] >>',
      },
    })
    const out = await redacted(doc, [[0, 40, 100, 70]])
    expect(await pageText(out)).toBe('')
    expect(await everything(out)).not.toMatch(/SECRET/)
    // the widget outside the area stays
    expect((out.resolve(out.pages()[0].dict.get('Annots')) as unknown[]).length).toBe(1)
  })

  test('hidden data: document information, XMP and thumbnails go only when asked', async () => {
    const { assemble } = await import('../../pdf-core/test/helpers.ts')
    const doc = await PdfDocument.load(
      assemble(
        [
          [1, '<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>'],
          [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
          [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Thumb 7 0 R >>'],
          [4, stream('', '0 0 10 10 re f')],
          [5, '<< /Title (Private title) >>'],
          [6, stream('/Type /Metadata /Subtype /XML', '<x:xmpmeta>Private</x:xmpmeta>')],
          [7, stream('/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', 'x')],
        ],
        '/Info 5 0 R',
      ).bytes,
    )
    const kept = await redacted(doc, [[0, 0, 5, 5]], false)
    expect(kept.trailer.has('Info')).toBe(true)
    expect(await everything(kept)).toMatch(/Private/)
    const gone = await redacted(doc, [[0, 0, 5, 5]], true)
    expect(gone.trailer.has('Info')).toBe(false)
    expect(await everything(gone)).not.toMatch(/Private/)
    expect(gone.pages()[0].dict.has('Thumb')).toBe(false)
  })
})

describe('where the areas are', () => {
  test('areas drawn on the page as displayed land in user space, whatever the rotation', async () => {
    const page = (rotate: number) => onePage({ content: '', box: '[0 0 200 100]', pageExtra: `/Rotate ${rotate}` })
    const top = { x: 0, y: 0, w: 0.5, h: 0.25 }
    expect(displayedArea(await page(0), 0, top)).toEqual([0, 75, 100, 100])
    // turned a quarter clockwise: the displayed top left is the user space bottom left
    expect(displayedArea(await page(90), 0, top)).toEqual([0, 0, 50, 50])
    expect(displayedArea(await page(180), 0, top)).toEqual([100, 0, 200, 25])
    expect(displayedArea(await page(270), 0, top)).toEqual([150, 50, 200, 100])
  })

  test('a field whose only widget is under an area leaves the form; the others stay', async () => {
    const { assemble } = await import('../../pdf-core/test/helpers.ts')
    const doc = await PdfDocument.load(
      assemble([
        [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R] >> >>'],
        [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
        [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Annots [5 0 R 6 0 R] >>'],
        [4, stream('', '')],
        [5, '<< /Type /Annot /Subtype /Widget /FT /Tx /T (hidden) /V (SECRET) /Rect [10 10 20 20] >>'],
        [6, '<< /Type /Annot /Subtype /Widget /FT /Tx /T (shown) /V (kept) /Rect [80 80 90 90] >>'],
      ]).bytes,
    )
    const out = await redacted(doc, [[0, 0, 50, 50]])
    const form = out.resolve(out.resolve(out.trailer.get('Root')) instanceof Map ? (out.resolve(out.trailer.get('Root')) as Map<string, never>).get('AcroForm') : null) as Map<string, unknown>
    expect((out.resolve(form.get('Fields') as never) as unknown[]).length).toBe(1)
    expect(await everything(out)).not.toMatch(/SECRET/)
  })
})
