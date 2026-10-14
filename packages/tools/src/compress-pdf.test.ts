import { beforeAll, describe, expect, test } from 'vitest'
import { UserError, deflate, type FileData } from '@ream/core'
import { createImage, decodeJpeg, encodeJpeg, ownCodec, setCodec, type ImageBuffer } from '@ream/image-core'
import { PdfDocument, PdfStream, decodeUntilImage, isName } from '@ream/pdf-core'
import { run as compress } from './compress-pdf/run.ts'
import { LEVELS } from './compress-pdf/options.ts'
import { looksPhotographic } from './compress-pdf/images.ts'
import { assemble } from '../../pdf-core/test/helpers.ts'

beforeAll(() => setCodec(ownCodec))

const ctx = { progress: () => {} }
const latin1 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192))
  return s
}
const body = (extra: string, data: Uint8Array) => `<< ${extra} /Length ${data.length} >>\nstream\n${latin1(data)}\nendstream`

/** a pseudo-random but repeatable photograph-like picture: smooth colour with noise */
function photo(w: number, h: number, grey = false): ImageBuffer {
  let seed = 11
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 41) - 20
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const base = [(x * 255) / w, (y * 255) / h, 128 + 80 * Math.sin((x + y) / 17)]
      const n = noise()
      const o = (y * w + x) * 4
      for (let c = 0; c < 3; c++) img.data[o + c] = Math.min(255, Math.max(0, (grey ? base[0] : base[c]) + n))
      img.data[o + 3] = 255
    }
  }
  return img
}

const rawSamples = (img: ImageBuffer, n: 1 | 3) => {
  const out = new Uint8Array(img.width * img.height * n)
  for (let i = 0; i < img.width * img.height; i++) for (let c = 0; c < n; c++) out[i * n + c] = img.data[i * 4 + c]
  return out
}

type Extra = [number, string][]

/** a one-page PDF showing image object 20 at `shown` x `shown` points, with more objects as given */
function pdfWith(imageObj: string, shown = 100, extra: Extra = [], shownHeight = shown): FileData {
  const objs: [number, string][] = [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /XObject << /Im 20 0 R >> >> /Contents 4 0 R >>'],
    [4, `<< /Length ${`q ${shown} 0 0 ${shownHeight} 10 10 cm /Im Do Q`.length} >>\nstream\nq ${shown} 0 0 ${shownHeight} 10 10 cm /Im Do Q\nendstream`],
    [20, imageObj],
    ...extra,
  ]
  return { name: 'scan.pdf', type: 'application/pdf', bytes: assemble(objs).bytes }
}

async function imagesOf(f: FileData) {
  const d = await PdfDocument.load(f.bytes)
  return [...d.objects.values()].filter((o): o is PdfStream => o instanceof PdfStream && isName(d.resolve(o.dict.get('Subtype')), 'Image'))
}
const filterOf = (s: PdfStream) => (s.dict.get('Filter') as { value: string } | undefined)?.value
const sizeOf = (s: PdfStream) => [s.dict.get('Width'), s.dict.get('Height')]
/** components in a JPEG's frame header */
const components = (jpeg: Uint8Array) => jpeg[jpeg.findIndex((b, i) => b === 0xff && jpeg[i + 1] === 0xc0) + 9]

const FLATE_RGB = '/Type /XObject /Subtype /Image /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode'

describe('compress-pdf', () => {
  test('a photographic picture shown small is saved as JPEG at the target resolution', async () => {
    const img = photo(600, 400)
    const src = pdfWith(`<< ${FLATE_RGB} /Width 600 /Height 400 ${body('', await deflate(rawSamples(img, 3))).slice(3)}`, 100, [], 200 / 3)
    const [out] = await compress([src], { level: 'balanced' }, ctx)
    const [im] = await imagesOf(out)
    expect(filterOf(im)).toBe('DCTDecode')
    // 600 px over 100 pt is 432 dpi; 150 dpi leaves 208 x 139
    expect(sizeOf(im)).toEqual([208, 139])
    expect(decodeJpeg(im.data).width).toBe(208)
    expect(out.bytes.length).toBeLessThan(src.bytes.length * 0.2)
  })

  test('lossless leaves pictures alone but still makes a valid file', async () => {
    const img = photo(120, 80)
    const stored = await deflate(rawSamples(img, 3))
    const src = pdfWith(`<< ${FLATE_RGB} /Width 120 /Height 80 ${body('', stored).slice(3)}`, 100)
    const [out] = await compress([src], { level: 'lossless' }, ctx)
    const [im] = await imagesOf(out)
    expect(filterOf(im)).toBe('FlateDecode')
    expect(Array.from(im.data)).toEqual(Array.from(stored))
    expect((await PdfDocument.load(out.bytes)).pages().length).toBe(1)
  })

  test('a JPEG already at the right resolution is saved again at the lower quality', async () => {
    const jpeg = encodeJpeg(photo(300, 200), { quality: 95 })
    const src = pdfWith(`<< /Type /XObject /Subtype /Image /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Width 300 /Height 200 ${body('', jpeg).slice(3)}`, 150)
    const [out] = await compress([src], { level: 'balanced' }, ctx)
    const [im] = await imagesOf(out)
    expect(sizeOf(im)).toEqual([300, 200]) // 144 dpi: not worth a resample
    expect(im.data.length).toBeLessThan(jpeg.length * 0.7)
  })

  test('a grey picture stays one component; an RGB picture that only looks grey keeps three', async () => {
    const grey = photo(300, 200, true)
    const asGray = pdfWith(`<< /Type /XObject /Subtype /Image /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Width 300 /Height 200 ${body('', await deflate(rawSamples(grey, 1))).slice(3)}`, 60)
    const [g] = await imagesOf((await compress([asGray], { level: 'balanced' }, ctx))[0])
    expect(filterOf(g)).toBe('DCTDecode')
    expect(components(g.data)).toBe(1)
    const asRgb = pdfWith(`<< ${FLATE_RGB} /Width 300 /Height 200 ${body('', await deflate(rawSamples(grey, 3))).slice(3)}`, 60)
    const [c] = await imagesOf((await compress([asRgb], { level: 'balanced' }, ctx))[0])
    expect(components(c.data)).toBe(3)
  })

  test('line art is not turned into JPEG; too sharp, it only loses pixels, losslessly', async () => {
    const flat = createImage(400, 300)
    for (let i = 0; i < 400 * 300; i++) flat.data.set((i % 400) % 40 < 20 ? [10, 10, 10, 255] : [250, 250, 250, 255], i * 4)
    expect(looksPhotographic(flat)).toBe(false)
    const sharp = pdfWith(`<< ${FLATE_RGB} /Width 400 /Height 300 ${body('', await deflate(rawSamples(flat, 3))).slice(3)}`, 100)
    const [im] = await imagesOf((await compress([sharp], { level: 'balanced' }, ctx))[0])
    expect(filterOf(im)).not.toBe('DCTDecode')
    expect(im.data.length).toBeLessThan(2000)
    // at the right size there is nothing to do at all
    const right = pdfWith(`<< ${FLATE_RGB} /Width 400 /Height 300 ${body('', await deflate(rawSamples(flat, 3))).slice(3)}`, 200)
    const [kept] = await imagesOf((await compress([right], { level: 'balanced' }, ctx))[0])
    expect(sizeOf(kept)).toEqual([400, 300])
  })

  test('pictures that depend on exact values or other models are left alone', async () => {
    const img = photo(300, 200)
    const data = await deflate(rawSamples(img, 3))
    const cases = [
      `<< ${FLATE_RGB} /Width 300 /Height 200 /ImageMask true ${body('', data).slice(3)}`,
      `<< ${FLATE_RGB} /Width 300 /Height 200 /Mask [0 5 0 5 0 5] ${body('', data).slice(3)}`,
      `<< ${FLATE_RGB} /Width 300 /Height 200 /Decode [1 0 1 0 1 0] ${body('', data).slice(3)}`,
      `<< /Type /XObject /Subtype /Image /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode /Width 300 /Height 200 ${body('', data).slice(3)}`,
      `<< /Type /XObject /Subtype /Image /ColorSpace [/Indexed /DeviceRGB 1 <000000ffffff>] /BitsPerComponent 8 /Filter /FlateDecode /Width 300 /Height 200 ${body('', data).slice(3)}`,
    ]
    for (const c of cases) {
      const src = pdfWith(c, 50)
      const [im] = await imagesOf((await compress([src], { level: 'small' }, ctx))[0])
      expect(Array.from(im.data)).toEqual(Array.from(data))
    }
  })

  test('a picture with transparency keeps its mask', async () => {
    const img = photo(300, 200)
    const mask = new Uint8Array(300 * 200).fill(200)
    const src = pdfWith(`<< ${FLATE_RGB} /Width 300 /Height 200 /SMask 21 0 R ${body('', await deflate(rawSamples(img, 3))).slice(3)}`, 50, [
      [21, `<< /Type /XObject /Subtype /Image /ColorSpace /DeviceGray /BitsPerComponent 8 /Width 300 /Height 200 /Filter /FlateDecode ${body('', await deflate(mask)).slice(3)}`],
    ])
    const out = (await compress([src], { level: 'balanced' }, ctx))[0]
    const d = await PdfDocument.load(out.bytes)
    const found = (await imagesOf(out)).find((i) => filterOf(i) === 'DCTDecode')!
    expect(found.dict.get('SMask')).toBeTruthy()
    const smask = d.resolve(found.dict.get('SMask')) as PdfStream
    expect(smask.dict.get('Width')).toBe(300)
    const { data } = await decodeUntilImage(smask)
    expect(data.every((v) => v === 200)).toBe(true)
  })

  test('smaller levels give smaller files', async () => {
    const img = photo(500, 350)
    const src = pdfWith(`<< ${FLATE_RGB} /Width 500 /Height 350 ${body('', await deflate(rawSamples(img, 3))).slice(3)}`, 200)
    const sizes = []
    for (const level of ['lossless', 'balanced', 'small'] as const) sizes.push((await compress([src], { level }, ctx))[0].bytes.length)
    expect(sizes[0]).toBeGreaterThan(sizes[1])
    expect(sizes[1]).toBeGreaterThan(sizes[2])
    expect(LEVELS.small.quality).toBeLessThan(LEVELS.balanced.quality)
  })

  test('a file that cannot get smaller comes back as it was', async () => {
    const once = (await compress([pdfWith(`<< ${FLATE_RGB} /Width 40 /Height 40 ${body('', await deflate(rawSamples(photo(40, 40), 3))).slice(3)}`, 100)], { level: 'lossless' }, ctx))[0]
    const [again] = await compress([once], { level: 'lossless' }, ctx)
    expect(Array.from(again.bytes)).toEqual(Array.from(once.bytes))
    expect(again.name).toBe('scan-compressed-compressed.pdf')
  })

  test('an unknown level and an unreadable file are readable errors', async () => {
    await expect(compress([pdfWith('<< >>')], { level: 'extreme' as never }, ctx)).rejects.toBeInstanceOf(UserError)
    await expect(compress([{ name: 'x.pdf', type: 'application/pdf', bytes: new TextEncoder().encode('nope') }], { level: 'lossless' }, ctx)).rejects.toThrow("x.pdf: This file isn't a PDF.")
  })
})
