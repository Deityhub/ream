import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { UserError, type FileData } from '@ream/core'
import { createImage, decodePng, encodePng, ownCodec, setCodec } from '@ream/image-core'
import { PdfDocument, PdfStream, decodeStream, readInfo } from '@ream/pdf-core'
import { run as imagesToPdf, type ImagesToPdfOptions } from './images-to-pdf/run.ts'
import { run as watermark, type WatermarkOptions } from './watermark/run.ts'
import { label, run as pageNumbers, type PageNumbersOptions } from './page-numbers/run.ts'
import { run as cropPdf, type CropPdfOptions } from './crop-pdf/run.ts'
import { defaultOptions as cropDefaults, marginsOf, pagesToCrop } from './crop-pdf/margins.ts'
import { run as metadata } from './metadata/run.ts'
import { run as extractImages } from './extract-images/run.ts'
import { rgb, spotCentre } from './pdf-common.ts'
import { assemble } from '../../pdf-core/test/helpers.ts'
import { MM, maxMarginMm } from './images-to-pdf/sizes.ts'

beforeAll(() => setCodec(ownCodec))

const ctx = { progress: () => {} }
const opts = (o: Partial<ImagesToPdfOptions> = {}): ImagesToPdfOptions => ({ size: 'fit', customWidth: 210, customHeight: 297, orientation: 'auto', margin: 0, ...o })
const fx = (name: string): FileData => ({ name, type: 'application/pdf', bytes: new Uint8Array(readFileSync(join(import.meta.dirname, '../../pdf-core/test/fixtures', name))) })
const png = async (name: string, w: number, h: number, px: (x: number, y: number) => number[]): Promise<FileData> => {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set(px(x, y), (y * w + x) * 4)
  return { name, type: 'image/png', bytes: await encodePng(img) }
}
const text = (f: { bytes: Uint8Array }) => new TextDecoder('latin1').decode(f.bytes)

/** the text shown by the content streams of each page */
async function contents(f: FileData): Promise<string[]> {
  const doc = await PdfDocument.load(f.bytes)
  const out: string[] = []
  for (const page of doc.pages()) {
    let s = ''
    for (const c of [doc.resolve(page.dict.get('Contents'))].flat().map((x) => doc.resolve(x))) if (c instanceof PdfStream) s += new TextDecoder('latin1').decode(await decodeStream(c)) + '\n'
    out.push(s)
  }
  return out
}
const sizes = async (f: FileData) => {
  const d = await PdfDocument.load(f.bytes)
  return d.pages().map((p) => d.pageSize(p))
}

describe('helpers', () => {
  test('rgb', () => {
    expect(rgb('#ff8000')).toBe('1 0.502 0')
    expect(rgb('#fff')).toBe('1 1 1')
    expect(() => rgb('red')).toThrow(UserError)
  })
  test('spotCentre', () => {
    const page = { width: 200, height: 100 }
    const box = { width: 20, height: 10 }
    expect(spotCentre('tl', page, box, 10)).toEqual([20, 85])
    expect(spotCentre('mc', page, box, 10)).toEqual([100, 50])
    expect(spotCentre('br', page, box, 10)).toEqual([180, 15])
  })
})

describe('images-to-pdf', () => {
  const o = opts({ size: 'a4', margin: 5 })
  test('one page per image, named after the input when there is one', async () => {
    const a = await png('a.png', 40, 20, () => [255, 0, 0, 255])
    const b = await png('b.png', 20, 40, () => [0, 0, 255, 255])
    const two = await imagesToPdf([a, b], o, ctx)
    expect(two[0].name).toBe('images.pdf')
    expect(await sizes(two[0])).toEqual([{ width: 842, height: 595 }, { width: 595, height: 842 }]) // each page follows its picture
    expect((await imagesToPdf([a], o, ctx))[0].name).toBe('a.pdf')
  })
  test('named page sizes, in both orientations', async () => {
    const tall = await png('t.png', 20, 40, () => [0, 0, 0, 255])
    const sizeOf = async (o: Partial<ImagesToPdfOptions>) => {
      const s = (await sizes((await imagesToPdf([tall], opts(o), ctx))[0]))[0]
      return [Math.round(s.width), Math.round(s.height)]
    }
    expect(await sizeOf({ size: 'a3' })).toEqual([842, 1191])
    expect(await sizeOf({ size: 'a5' })).toEqual([420, 595])
    expect(await sizeOf({ size: 'b5' })).toEqual([499, 709])
    expect(await sizeOf({ size: 'legal' })).toEqual([612, 1008])
    expect(await sizeOf({ size: 'tabloid', orientation: 'landscape' })).toEqual([1224, 792])
    expect(await sizeOf({ size: 'executive', orientation: 'portrait' })).toEqual([522, 756])
  })
  test('custom size in millimetres is clamped to something a PDF can hold', async () => {
    const f = await png('t.png', 10, 10, () => [0, 0, 0, 255])
    const size = async (o: Partial<ImagesToPdfOptions>) => (await sizes((await imagesToPdf([f], opts({ size: 'custom', orientation: 'portrait', ...o }), ctx))[0]))[0]
    const a = await size({ customWidth: 100, customHeight: 150 })
    expect([a.width, a.height].map((v) => Math.round(v * 10) / 10)).toEqual([283.5, 425.2])
    const huge = await size({ customWidth: 99999, customHeight: 5 })
    expect(huge.width).toBeCloseTo(20 * MM, 0) // portrait puts the short side across
    expect(huge.height).toBeCloseTo(5080 * MM, 0)
  })
  test('the margin is in millimetres and cannot swallow the page', async () => {
    const f = await png('t.png', 100, 100, () => [0, 0, 0, 255])
    const place = async (o: Partial<ImagesToPdfOptions>) => {
      const c = (await contents((await imagesToPdf([f], opts({ size: 'a5', ...o }), ctx))[0]))[0]
      return c.match(/q ([\d.]+) 0 0 [\d.]+ ([\d.]+) /)!.slice(1).map(Number)
    }
    const [w10] = await place({ margin: 10 })
    expect(w10).toBeCloseTo(420 - 2 * 10 * MM, 1) // a square picture fills the width of A5 inside the margins
    expect(maxMarginMm(opts({ size: 'a5' }))).toBe(64)
    expect(maxMarginMm(opts({ size: 'fit' }))).toBe(150)
    const [wBig] = await place({ margin: 1000 }) // an out-of-range value is clamped, not an error
    expect(wBig).toBeCloseTo(420 - 2 * 64 * MM, 1)
  })
  test('a JPEG is not decoded at all', async () => {
    // header-only JPEG: the PNG-only test codec would choke on it if it were decoded
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 30, 0, 40, 1, 1, 0x11, 0, 0xff, 0xda, 0, 2])
    const out = await imagesToPdf([{ name: 'p.jpg', type: 'image/jpeg', bytes: jpg }], opts(), ctx)
    expect(await sizes(out[0])).toEqual([{ width: 30, height: 22.5 }])
    expect(text(out[0])).toContain('/DCTDecode')
  })
  test('transparent PNGs keep their transparency', async () => {
    const f = await png('t.png', 4, 4, (x) => [10, 20, 30, x < 2 ? 0 : 255])
    expect(text((await imagesToPdf([f], o, ctx))[0])).toContain('/SMask')
  })
})

describe('watermark', () => {
  const o: WatermarkOptions = { text: 'DRAFT', size: 60, bold: true, italic: false, color: '#ff0000', opacity: 25, angle: 45, layout: 'single', spot: 'mc', spacing: 60, layer: 'over', pages: '' }
  test('stamps every page, or only the chosen ones', async () => {
    const all = await contents((await watermark([fx('chromium.pdf')], o, ctx))[0])
    expect(all).toHaveLength(3)
    for (const c of all) {
      expect(c).toContain('(DRAFT) Tj')
      expect(c).toContain('1 0 0 rg')
      expect(c).toContain('/ReamGS gs')
      expect(c).toContain('/ReamHelveticaBold 60 Tf')
    }
    const some = await contents((await watermark([fx('chromium.pdf')], { ...o, pages: '2-3' }, ctx))[0])
    expect(some.map((c) => c.includes('(DRAFT)'))).toEqual([false, true, true])
  })
  test('repeat covers the page with copies in a brick pattern', async () => {
    const [single] = await contents((await watermark([fx('cups.pdf')], o, ctx))[0])
    const [tiled] = await contents((await watermark([fx('cups.pdf')], { ...o, layout: 'tile', angle: 0, size: 20, spacing: 40 }, ctx))[0])
    expect(single.match(/\(DRAFT\) Tj/g)).toHaveLength(1)
    const at = [...tiled.matchAll(/1 0 0 1 ([-\d.]+) ([-\d.]+) Tm \(DRAFT\) Tj/g)].map((m) => [Number(m[1]), Number(m[2])])
    expect(at.length).toBeGreaterThan(30)
    // rows: all copies of one row share a y, the next row starts half a pitch further along
    const rows = [...new Set(at.map(([, y]) => y))].sort((a, b) => a - b)
    const xs = (y: number) => at.filter(([, yy]) => yy === y).map(([x]) => x).sort((a, b) => a - b)
    const pitch = xs(rows[0])[1] - xs(rows[0])[0]
    expect(Math.abs(xs(rows[1])[0] - xs(rows[0])[0]) % pitch).toBeCloseTo(pitch / 2, 1)
    // every copy is on or near the page (cups.pdf is a Letter or A4 page, so well inside 1000 points)
    const m = /1 0 0 1 ([-\d.]+) ([-\d.]+) cm/.exec(tiled)!
    for (const [x, y] of at) {
      expect(Math.abs(Number(m[1]) + x)).toBeLessThan(1000)
      expect(Math.abs(Number(m[2]) + y)).toBeLessThan(1000)
    }
  })
  test('repeat: more spacing means fewer copies, and an absurd density is refused', async () => {
    const count = async (spacing: number) => (await contents((await watermark([fx('cups.pdf')], { ...o, layout: 'tile', size: 20, spacing }, ctx))[0]))[0].match(/\(DRAFT\) Tj/g)!.length
    expect(await count(0)).toBeGreaterThan(await count(100))
    await expect(watermark([fx('cups.pdf')], { ...o, text: 'a', layout: 'tile', size: 6, spacing: 0 }, ctx)).rejects.toThrow(/spacing is too small/i)
  })
  test('behind puts the stamp before the page content', async () => {
    const [first] = await contents((await watermark([fx('cups.pdf')], { ...o, layer: 'under' }, ctx))[0])
    expect(first.indexOf('(DRAFT)')).toBeLessThan(first.indexOf('BT', first.indexOf('(DRAFT)') + 10))
  })
  test('errors are readable', async () => {
    await expect(watermark([fx('cups.pdf')], { ...o, text: '  ' }, ctx)).rejects.toThrow('Enter the watermark text')
    await expect(watermark([fx('cups.pdf')], { ...o, text: '日本' }, ctx)).rejects.toThrow(/can't be drawn yet/)
    await expect(watermark([fx('cups.pdf')], { ...o, pages: '9' }, ctx)).rejects.toThrow("Page 9 doesn't exist")
  })
})

describe('page-numbers', () => {
  const o: PageNumbersOptions = { format: 'n', spot: 'bc', start: 1, from: 1, size: 11, color: '#000000' }
  test('labels', () => {
    expect(label('n', 3, 10)).toBe('3')
    expect(label('page-n', 3, 10)).toBe('Page 3')
    expect(label('n-of-total', 3, 10)).toBe('3 of 10')
    expect(label('page-n-of-total', 3, 10)).toBe('Page 3 of 10')
  })
  test('numbers from the first page', async () => {
    const c = await contents((await pageNumbers([fx('chromium.pdf')], { ...o, format: 'page-n-of-total' }, ctx))[0])
    expect(c.map((s) => /\((Page \d of \d)\) Tj/.exec(s)?.[1])).toEqual(['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3'])
  })
  test('skips a cover and starts counting at the chosen number', async () => {
    const c = await contents((await pageNumbers([fx('chromium.pdf')], { ...o, format: 'n-of-total', from: 2, start: 5 }, ctx))[0])
    expect(c.map((s) => /\((\d+ of \d+)\) Tj/.exec(s)?.[1])).toEqual([undefined, '5 of 6', '6 of 6'])
  })
  test('the number sits at the chosen edge', async () => {
    const [bottom] = await contents((await pageNumbers([fx('chromium.pdf')], o, ctx))[0])
    const [top] = await contents((await pageNumbers([fx('chromium.pdf')], { ...o, spot: 'tr' }, ctx))[0])
    const y = (s: string) => Number(/Tf ([\d.]+) ([\d.]+) Td \(1\)/.exec(s)![2])
    expect(y(bottom)).toBeLessThan(40)
    expect(y(top)).toBeGreaterThan(740)
  })
})

describe('crop-pdf', () => {
  const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })
  const opts = (o: Partial<CropPdfOptions> = {}): CropPdfOptions => ({ ...cropDefaults, remove: false, ...o })
  const near = (s: { width: number; height: number }, [ew, eh]: number[]) => {
    expect(s.width).toBeCloseTo(ew, 1)
    expect(s.height).toBeCloseTo(eh, 1)
  }

  test('one selection becomes the same proportions on every page', async () => {
    const [{ width: w, height: h }] = await sizes(fx('chromium.pdf'))
    const out = await sizes((await cropPdf([fx('chromium.pdf')], opts({ rect: rect(0.1, 0.2, 0.5, 0.25) }), ctx))[0])
    expect(out).toHaveLength(3)
    for (const s of out) near(s, [w * 0.5, h * 0.25])
  })
  test('per-page selections leave the other pages alone', async () => {
    const [{ width: w, height: h }] = await sizes(fx('chromium.pdf'))
    const out = await sizes((await cropPdf([fx('chromium.pdf')], opts({ scope: 'page', rects: { 1: rect(0, 0, 0.5, 0.5) } }), ctx))[0])
    near(out[0], [w, h])
    near(out[1], [w / 2, h / 2])
    near(out[2], [w, h])
  })
  test('the margins left by a selection put the kept area where it was dragged', () => {
    const m = marginsOf(rect(0.1, 0.2, 0.5, 0.25), { width: 200, height: 400 })
    expect(m.map((v) => Math.round(v * 1000) / 1000)).toEqual([80, 80, 220, 20]) // top, right, bottom, left
    expect(pagesToCrop(opts({ scope: 'page', rects: { 0: rect(0, 0, 1, 1), 2: rect(0, 0, 0.5, 1) } }), 4)).toEqual([2]) // a whole-page selection means no crop
  })
  test('nothing selected is a readable error', async () => {
    await expect(cropPdf([fx('cups.pdf')], opts(), ctx)).rejects.toThrow('Drag on the page to choose the area to keep.')
    await expect(cropPdf([fx('cups.pdf')], opts({ scope: 'page' }), ctx)).rejects.toThrow('Drag on the page')
  })
})

describe('crop-pdf delete', () => {
  // a 200 x 200 page: text, a rectangle and a picture in the top-left quarter (kept) and the same kinds of things elsewhere (cut)
  const IMG_MARKER = 'OUTSIDE_IMAGE_MK' // 16 bytes: a 4 x 4 grey picture whose pixels are this text
  const font = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 126 /Widths [${Array(95).fill(500).join(' ')}] >>`
  const content = [
    'BT /F1 12 Tf 10 150 Td (KEEP THIS TEXT) Tj ET',
    '0 0 1 rg 10 110 30 30 re f',
    'BT /F1 12 Tf 10 20 Td (SECRET OUTSIDE) Tj ET',
    'q 40 0 0 40 120 20 cm /Pic Do Q',
    '1 0 0 rg 120 120 30 30 re f',
  ].join('\n')
  const make = () =>
    assemble([
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
      [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> /XObject << /Pic 6 0 R >> >> /Contents 4 0 R /Annots [7 0 R 8 0 R] >>'],
      [4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
      [5, font],
      [6, `<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 16 >>\nstream\n${IMG_MARKER}\nendstream`],
      [7, '<< /Type /Annot /Subtype /Link /Rect [10 150 80 165] /Border [0 0 0] >>'],
      [8, '<< /Type /Annot /Subtype /Link /Rect [120 20 160 60] /Border [0 0 0] >>'],
    ]).bytes
  const input: FileData = { name: 'p.pdf', type: 'application/pdf', bytes: make() }
  const topLeft = { scope: 'all' as const, rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, rects: {} }
  const raw = (f: FileData) => new TextDecoder('latin1').decode(f.bytes)

  test('delete removes what is outside, from the content, the resources and the annotations', async () => {
    const out = (await cropPdf([input], { ...topLeft, remove: true }, ctx))[0]
    const doc = await PdfDocument.load(out.bytes)
    const [page] = doc.pages()
    expect(doc.pageSize(page)).toEqual({ width: 100, height: 100 })
    expect(doc.pageBox(page).box).toEqual([0, 100, 100, 200])
    const [c] = await contents(out)
    expect(c).toContain('(KEEP THIS TEXT) Tj')
    expect(c).toContain('10 110 30 30 re f')
    expect(c).not.toContain('SECRET OUTSIDE')
    expect(c).not.toContain('/Pic Do')
    expect(c).toContain('120 120 30 30 re n') // painted outside: no longer painted
    expect(raw(out)).not.toContain(IMG_MARKER) // the picture's pixels are not in the file at all
    expect(raw(out)).not.toContain('120 20 160') // nor the link over it
    expect(raw(out)).toContain('10 150 80 165') // the link on the kept text stays
    expect(raw(out)).not.toContain('/Pic') // and its resource entry is gone
  })

  test('hide keeps everything in the file and only shrinks the page', async () => {
    const out = (await cropPdf([input], { ...topLeft, remove: false }, ctx))[0]
    const doc = await PdfDocument.load(out.bytes)
    expect(doc.pageSize(doc.pages()[0])).toEqual({ width: 100, height: 100 })
    expect(raw(out)).toContain(IMG_MARKER)
    expect((await contents(out))[0]).toContain('SECRET OUTSIDE')
    expect(out.bytes.length).toBeGreaterThan((await cropPdf([input], { ...topLeft, remove: true }, ctx))[0].bytes.length)
  })

  test('a deleted page is still a valid document and does not change what is seen', async () => {
    const out = (await cropPdf([input], { ...topLeft, remove: true }, ctx))[0]
    const doc = await PdfDocument.load(out.bytes)
    // the kept text is where it was, in the same page space
    expect((await contents(out))[0]).toContain('10 150 Td')
    expect(doc.pages()).toHaveLength(1)
  })

  test('delete on a rotated page cuts what is outside the displayed selection', async () => {
    const rotated = { ...input, bytes: new TextEncoder().encode(raw(input).replace('/MediaBox [0 0 200 200]', '/MediaBox [0 0 200 200] /Rotate 90')) }
    // displayed top-left quarter of a page turned 90 degrees clockwise is the page's own bottom-left quarter
    const out = (await cropPdf([rotated], { ...topLeft, remove: true }, ctx))[0]
    const doc = await PdfDocument.load(out.bytes)
    expect(doc.pageBox(doc.pages()[0]).box).toEqual([0, 0, 100, 100])
    const [c] = await contents(out)
    expect(c).toContain('SECRET OUTSIDE') // the text at the bottom-left is inside that quarter
    expect(c).not.toContain('(KEEP THIS TEXT)')
  })
})

describe('metadata', () => {
  test('changed fields only: others stay, empty removes', async () => {
    const one = (await metadata([fx('cups.pdf')], { fields: { Title: 'Report', Author: 'Ada', Keywords: 'x' } }, ctx))[0]
    const two = (await metadata([one], { fields: { Author: 'Grace', Keywords: '' } }, ctx))[0]
    const info = readInfo(await PdfDocument.load(two.bytes))
    expect(info).toMatchObject({ Title: 'Report', Author: 'Grace' })
    expect('Keywords' in info).toBe(false)
    expect(two.name).toBe('cups-edited-edited.pdf')
  })
})

describe('extract-images', () => {
  test('a PNG put into a PDF comes back pixel for pixel, with its transparency', async () => {
    const src = await png('s.png', 5, 3, (x, y) => [x * 40, y * 80, 9, x === 4 ? 0 : 255])
    const pdf = (await imagesToPdf([src], opts(), ctx))[0]
    const out = await extractImages([pdf], { minSize: 0 }, ctx)
    expect(out.map((f) => f.name)).toEqual(['s-page1-image1.png'])
    expect(Array.from((await decodePng(out[0].bytes)).data)).toEqual(Array.from((await decodePng(src.bytes)).data))
  })
  test('a JPEG comes out byte for byte', async () => {
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 30, 0, 40, 1, 1, 0x11, 0, 0xff, 0xda, 0, 2])
    const pdf = (await imagesToPdf([{ name: 'p.jpg', type: 'image/jpeg', bytes: jpg }], opts({ size: 'a4' }), ctx))[0]
    const out = await extractImages([pdf], { minSize: 0 }, ctx)
    expect(out[0].name).toBe('p-page1-image1.jpg')
    expect(Array.from(out[0].bytes)).toEqual(Array.from(jpg))
  })
  test('small pictures are skipped on request; no pictures is a readable error', async () => {
    const pdf = (await imagesToPdf([await png('s.png', 5, 3, () => [1, 2, 3, 255])], opts(), ctx))[0]
    await expect(extractImages([pdf], { minSize: 32 }, ctx)).rejects.toThrow(/smaller than 32 pixels/)
    await expect(extractImages([fx('cups.pdf')], { minSize: 0 }, ctx)).rejects.toThrow("doesn't have any pictures")
  })
})
