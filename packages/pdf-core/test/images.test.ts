import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfRangeError, PdfStream, decodeStream, imagesToPdf, isDict, isName, jpegInfo } from '../src/index.ts'

const u16 = (n: number) => [n >> 8, n & 255]
/** just enough of a JPEG for the header reader: SOI, optional APP1 EXIF / APP14 Adobe, SOF, SOS */
function jpeg(o: { w: number; h: number; n?: number; sof?: number; precision?: number; orientation?: number; adobe?: boolean; be?: boolean }) {
  const out = [0xff, 0xd8]
  if (o.orientation) {
    const t = o.be === false ? (v: number) => [v & 255, v >> 8] : u16
    const tiff = [...(o.be === false ? [0x49, 0x49, 42, 0] : [0x4d, 0x4d, 0, 42]), ...(o.be === false ? [8, 0, 0, 0] : [0, 0, 0, 8]), ...t(1), ...t(0x0112), ...t(3), ...(o.be === false ? [1, 0, 0, 0] : [0, 0, 0, 1]), ...t(o.orientation), 0, 0, 0, 0, 0, 0]
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
    out.push(0xff, 0xe1, ...u16(body.length + 2), ...body)
  }
  if (o.adobe) out.push(0xff, 0xee, ...u16(14), 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 2)
  const n = o.n ?? 3
  out.push(0xff, o.sof ?? 0xc0, ...u16(8 + 3 * n), o.precision ?? 8, ...u16(o.h), ...u16(o.w), n)
  for (let i = 0; i < n; i++) out.push(i + 1, 0x11, 0)
  out.push(0xff, 0xda, 0, 2)
  return Uint8Array.from(out)
}

describe('jpegInfo', () => {
  test('size, components, orientation, Adobe marker', () => {
    expect(jpegInfo(jpeg({ w: 640, h: 480 }))).toEqual({ width: 640, height: 480, components: 3, orientation: 1, adobe: false })
    expect(jpegInfo(jpeg({ w: 10, h: 20, n: 1 }))?.components).toBe(1)
    expect(jpegInfo(jpeg({ w: 10, h: 20, n: 4, adobe: true }))).toMatchObject({ components: 4, adobe: true })
    expect(jpegInfo(jpeg({ w: 10, h: 20, sof: 0xc2 }))?.width).toBe(10) // progressive is fine
  })
  test('EXIF orientation, both byte orders', () => {
    expect(jpegInfo(jpeg({ w: 4, h: 3, orientation: 6 }))?.orientation).toBe(6)
    expect(jpegInfo(jpeg({ w: 4, h: 3, orientation: 8, be: false }))?.orientation).toBe(8)
  })
  test('what can not go in as is gives null', () => {
    expect(jpegInfo(new TextEncoder().encode('not a jpeg'))).toBeNull()
    expect(jpegInfo(jpeg({ w: 4, h: 3, precision: 12 }))).toBeNull()
    expect(jpegInfo(jpeg({ w: 4, h: 3, sof: 0xc9 }))).toBeNull() // arithmetic coding
    expect(jpegInfo(jpeg({ w: 4, h: 3 }).subarray(0, 10))).toBeNull()
  })
})

const rgba = (w: number, h: number, px: (x: number, y: number) => number[]) => {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(px(x, y), (y * w + x) * 4)
  return d
}
const imageOf = async (doc: PdfDocument, page: number) => {
  const res = doc.resolve(doc.pages()[page].dict.get('Resources'))
  const xo = isDict(res) ? doc.resolve(res.get('XObject')) : null
  const im = isDict(xo) ? doc.resolve(xo.get('Im0')) : null
  if (!(im instanceof PdfStream)) throw new Error('no image')
  return im
}

describe('imagesToPdf', () => {
  test('raw pixels: Flate RGB, with a soft mask only when something is transparent', async () => {
    const opaque = { width: 2, height: 2, rgba: rgba(2, 2, (x, y) => [x * 100, y * 100, 7, 255]) }
    const clear = { width: 2, height: 1, rgba: rgba(2, 1, (x) => [9, 8, 7, x ? 0 : 255]) }
    const doc = await PdfDocument.load(await imagesToPdf([opaque, clear], { size: 'fit', orientation: 'auto', margin: 0 }))
    expect(doc.pages()).toHaveLength(2)
    const a = await imageOf(doc, 0)
    expect(Array.from(await decodeStream(a))).toEqual([0, 0, 7, 100, 0, 7, 0, 100, 7, 100, 100, 7])
    expect(a.dict.has('SMask')).toBe(false)
    const b = await imageOf(doc, 1)
    const mask = doc.resolve(b.dict.get('SMask'))
    expect(mask instanceof PdfStream && Array.from(await decodeStream(mask))).toEqual([255, 0])
  })

  test('a JPEG is embedded untouched', async () => {
    const bytes = jpeg({ w: 30, h: 20 })
    const doc = await PdfDocument.load(await imagesToPdf([{ width: 30, height: 20, jpeg: bytes, components: 3, adobe: false }], { size: 'fit', orientation: 'auto', margin: 0 }))
    const im = await imageOf(doc, 0)
    expect(isName(im.dict.get('Filter'), 'DCTDecode')).toBe(true)
    expect(Array.from(im.data)).toEqual(Array.from(bytes))
  })

  test('Adobe CMYK gets an inverting /Decode', async () => {
    const doc = await PdfDocument.load(await imagesToPdf([{ width: 3, height: 3, jpeg: jpeg({ w: 3, h: 3, n: 4, adobe: true }), components: 4, adobe: true }], { size: 'fit', orientation: 'auto', margin: 0 }))
    expect((await imageOf(doc, 0)).dict.get('Decode')).toEqual([1, 0, 1, 0, 1, 0, 1, 0])
  })

  test('page geometry: fit, fixed size with orientation, margins', async () => {
    const wide = { width: 400, height: 200, rgba: new Uint8ClampedArray(400 * 200 * 4).fill(255) }
    const sizes = async (setup: Parameters<typeof imagesToPdf>[1]) => {
      const d = await PdfDocument.load(await imagesToPdf([wide], setup))
      return d.pageSize(d.pages()[0])
    }
    expect(await sizes({ size: 'fit', orientation: 'auto', margin: 0 })).toEqual({ width: 300, height: 150 }) // 96 dpi to 72
    expect(await sizes({ size: 'fit', orientation: 'auto', margin: 10 })).toEqual({ width: 320, height: 170 })
    expect(await sizes({ size: [595, 842], orientation: 'auto', margin: 0 })).toEqual({ width: 842, height: 595 }) // wide picture, landscape page
    expect(await sizes({ size: [595, 842], orientation: 'portrait', margin: 0 })).toEqual({ width: 595, height: 842 })
    // the picture fills the width inside the margins and is centred vertically
    const d = await PdfDocument.load(await imagesToPdf([wide], { size: [595, 842], orientation: 'portrait', margin: 20 }))
    const c = d.resolve(d.pages()[0].dict.get('Contents'))
    expect(c instanceof PdfStream && new TextDecoder().decode(await decodeStream(c))).toBe('q 555 0 0 277.5 20 282.25 cm /Im0 Do Q\n')
  })

  test('errors are readable', async () => {
    await expect(imagesToPdf([], { size: 'fit', orientation: 'auto', margin: 0 })).rejects.toBeInstanceOf(PdfRangeError)
    await expect(imagesToPdf([{ width: 1, height: 1, rgba: new Uint8ClampedArray(4) }], { size: [100, 100], orientation: 'auto', margin: 60 })).rejects.toThrow(/margin is too big/)
  })
})
