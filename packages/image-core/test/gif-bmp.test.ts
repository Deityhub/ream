import { describe, expect, test } from 'vitest'
import { UserError } from '@ream/core'
import { UnsupportedImage } from '../src/index.ts'
import { appCodec } from '../src/browser.ts'
import { buildPalette, createImage, decodeBmp, decodeGif, decodeJpeg, encodeBmp, encodeGif, encodeJpeg, mapToPalette, ownCodec, quantize, type ImageBuffer } from '../src/index.ts'

const make = (w: number, h: number, px: (x: number, y: number) => number[]): ImageBuffer => {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set(px(x, y), (y * w + x) * 4)
  return img
}
const pixel = (img: ImageBuffer, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4))
const psnr = (a: ImageBuffer, b: ImageBuffer) => {
  let s = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++, n++) s += (a.data[i + c] - b.data[i + c]) ** 2
  return s === 0 ? Infinity : 10 * Math.log10(255 ** 2 / (s / n))
}
const distinct = (img: ImageBuffer) => new Set(Array.from({ length: img.width * img.height }, (_, i) => Array.from(img.data.subarray(i * 4, i * 4 + 4)).join(','))).size

// ---------- a GIF writer for tests: stored (not compressed) LZW, so decoding is checked against something independent ----------

type GifFrameSpec = {
  x?: number
  y?: number
  w: number
  h: number
  /** colour table indices, row by row as stored */
  indices: number[]
  palette?: number[][]
  interlaced?: boolean
  delayCs?: number
  disposal?: number
  transparent?: number
}

/** LZW that only uses literal codes, with a clear code often enough that the code size never has to grow */
function storedLzw(indices: number[], minSize: number): number[] {
  const clear = 1 << minSize
  const size = minSize + 1
  const bytes: number[] = []
  let buf = 0
  let bits = 0
  const emit = (code: number) => {
    buf |= code << bits
    bits += size
    while (bits >= 8) {
      bytes.push(buf & 255)
      buf >>>= 8
      bits -= 8
    }
  }
  emit(clear)
  let since = 0
  for (const i of indices) {
    emit(i)
    if (++since === clear - 2) {
      emit(clear)
      since = 0
    }
  }
  emit(clear + 1)
  if (bits) bytes.push(buf & 255)
  return bytes
}

function buildGif(w: number, h: number, global: number[][] | null, frames: GifFrameSpec[], loops?: number): Uint8Array {
  const out: number[] = Array.from('GIF89a', (c) => c.charCodeAt(0))
  out.push(w & 255, w >> 8, h & 255, h >> 8, global ? 0x80 | (Math.log2(global.length) - 1) : 0, 0, 0)
  if (global) for (const c of global) out.push(c[0], c[1], c[2])
  if (loops !== undefined) out.push(0x21, 0xff, 11, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 3, 1, loops & 255, loops >> 8, 0)
  for (const f of frames) {
    const table = f.palette ?? global!
    const minSize = Math.max(2, Math.log2(table.length))
    out.push(0x21, 0xf9, 4, ((f.disposal ?? 0) << 2) | (f.transparent !== undefined ? 1 : 0), (f.delayCs ?? 0) & 255, (f.delayCs ?? 0) >> 8, f.transparent ?? 0, 0)
    out.push(0x2c, (f.x ?? 0) & 255, 0, (f.y ?? 0) & 255, 0, f.w & 255, f.w >> 8, f.h & 255, f.h >> 8)
    out.push((f.palette ? 0x80 | (Math.log2(table.length) - 1) : 0) | (f.interlaced ? 0x40 : 0))
    if (f.palette) for (const c of f.palette) out.push(c[0], c[1], c[2])
    out.push(minSize)
    const data = storedLzw(f.indices, minSize)
    for (let at = 0; at < data.length; at += 255) out.push(Math.min(255, data.length - at), ...data.slice(at, at + 255))
    out.push(0)
  }
  out.push(0x3b)
  return Uint8Array.from(out)
}

const RED = [255, 0, 0]
const GREEN = [0, 255, 0]
const BLUE = [0, 0, 255]
const WHITE = [255, 255, 255]

describe('decoding GIF', () => {
  test('one frame with a global table', () => {
    const gif = decodeGif(buildGif(2, 2, [RED, GREEN, BLUE, WHITE], [{ w: 2, h: 2, indices: [0, 1, 2, 3] }]))
    expect([gif.width, gif.height, gif.frames.length]).toEqual([2, 2, 1])
    const f = gif.frames[0].image
    expect([pixel(f, 0, 0), pixel(f, 1, 0), pixel(f, 0, 1), pixel(f, 1, 1)]).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]])
  })

  test('long runs: the stored LZW passes through code size boundaries and table clears', () => {
    const indices = Array.from({ length: 40 * 40 }, (_, i) => (i * 7 + (i >> 3)) % 4)
    const gif = decodeGif(buildGif(40, 40, [RED, GREEN, BLUE, WHITE], [{ w: 40, h: 40, indices }]))
    const table = [RED, GREEN, BLUE, WHITE]
    for (let i = 0; i < indices.length; i++) expect(Array.from(gif.frames[0].image.data.subarray(i * 4, i * 4 + 3))).toEqual(table[indices[i]])
  })

  test('interlaced rows are put back in display order', () => {
    // 5 rows are stored as display rows 0, 4, 2, 1, 3 (each row one colour: its own number)
    const palette = [[0, 0, 0], [10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0], [70, 0, 0]]
    const stored = [0, 4, 2, 1, 3]
    const gif = decodeGif(buildGif(2, 5, palette, [{ w: 2, h: 5, indices: stored.flatMap((r) => [r, r]), interlaced: true }]))
    for (let y = 0; y < 5; y++) expect(pixel(gif.frames[0].image, 0, y)[0]).toBe(y * 10)
  })

  test('a later frame is drawn over the earlier ones where it is not transparent', () => {
    const gif = decodeGif(
      buildGif(3, 1, [RED, GREEN, BLUE, WHITE], [
        { w: 3, h: 1, indices: [0, 0, 0], delayCs: 10 },
        { x: 1, w: 2, h: 1, indices: [3, 1], transparent: 3, delayCs: 25 },
      ]),
    )
    expect(gif.frames.map((f) => f.delay)).toEqual([100, 250])
    expect([0, 1, 2].map((x) => pixel(gif.frames[1].image, x, 0))).toEqual([[255, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255]])
  })

  test('disposal 2 clears the frame\'s area before the next one, disposal 3 puts back what was there', () => {
    const pal = [RED, GREEN, BLUE, WHITE]
    const base = { w: 3, h: 1, indices: [0, 0, 0] }
    const clear = decodeGif(buildGif(3, 1, pal, [base, { x: 1, w: 1, h: 1, indices: [1], disposal: 2 }, { x: 0, w: 1, h: 1, indices: [2] }]))
    // frame 3 follows a frame that asked to be cleared: its rectangle (pixel 1) is transparent again, the rest of frame 1 stays
    expect([0, 1, 2].map((x) => pixel(clear.frames[2].image, x, 0))).toEqual([[0, 0, 255, 255], [0, 0, 0, 0], [255, 0, 0, 255]])
    const restore = decodeGif(buildGif(3, 1, pal, [base, { x: 1, w: 1, h: 1, indices: [1], disposal: 3 }, { x: 0, w: 1, h: 1, indices: [2] }]))
    expect([0, 1, 2].map((x) => pixel(restore.frames[2].image, x, 0))).toEqual([[0, 0, 255, 255], [255, 0, 0, 255], [255, 0, 0, 255]])
  })

  test('local colour tables, loop count and frame limits', () => {
    const bytes = buildGif(
      1,
      1,
      null,
      [
        { w: 1, h: 1, indices: [1], palette: [RED, GREEN] },
        { w: 1, h: 1, indices: [1], palette: [BLUE, WHITE] },
        { w: 1, h: 1, indices: [0], palette: [BLUE, WHITE] },
      ],
      3,
    )
    const gif = decodeGif(bytes)
    expect(gif.loops).toBe(3)
    expect(gif.frames.map((f) => pixel(f.image, 0, 0))).toEqual([[0, 255, 0, 255], [255, 255, 255, 255], [0, 0, 255, 255]])
    expect(decodeGif(bytes, { firstOnly: true }).frames.length).toBe(1)
    expect(decodeGif(bytes, { maxFrames: 2 }).frames.length).toBe(2)
  })

  test('pixel data that ends early keeps what was read; the rest is the first colour', () => {
    const gif = decodeGif(buildGif(10, 10, [RED, GREEN, BLUE, WHITE], [{ w: 10, h: 10, indices: new Array(30).fill(1) }]))
    const f = gif.frames[0].image
    expect([pixel(f, 9, 2), pixel(f, 0, 3)]).toEqual([[0, 255, 0, 255], [255, 0, 0, 255]])
  })

  test('refuses what is not a GIF, and files without a picture', () => {
    expect(() => decodeGif(Uint8Array.from([1, 2, 3]))).toThrow("This isn't a GIF file.")
    expect(() => decodeGif(buildGif(2, 2, [RED, GREEN], []))).toThrow('damaged')
  })
})

describe('writing GIF', () => {
  const frame = (t: number, alpha = false) =>
    make(60, 40, (x, y) => {
      const inside = Math.hypot(x - (10 + t * 8), y - 20) < 9
      return inside ? [250, 100 + t * 30, 20, 255] : [(x * 255) / 60, (y * 255) / 40, 180 - x, alpha && (x + y) % 5 === 0 ? 0 : 255]
    })

  test('a single picture comes back close to the original', () => {
    const img = frame(0)
    const back = decodeGif(encodeGif([{ image: img, delay: 0 }])).frames[0].image
    expect(psnr(img, back)).toBeGreaterThan(30)
  })

  test('frames, delays and loop count are kept; only the changed part of a frame is stored', () => {
    const frames = [0, 1, 2, 3].map((t) => ({ image: frame(t), delay: 40 + t * 10 }))
    const bytes = encodeGif(frames, { loops: 5 })
    const gif = decodeGif(bytes)
    expect(gif.frames.length).toBe(4)
    expect(gif.frames.map((f) => f.delay)).toEqual([40, 50, 60, 70])
    expect(gif.loops).toBe(5)
    for (let i = 0; i < 4; i++) expect(psnr(frames[i].image, gif.frames[i].image)).toBeGreaterThan(28)
    const separate = frames.reduce((n, f) => n + encodeGif([f]).length, 0)
    expect(bytes.length).toBeLessThan(separate * 0.8)
  })

  test('transparent pixels stay transparent and opaque ones stay opaque', () => {
    const frames = [0, 1].map((t) => ({ image: frame(t, true), delay: 50 }))
    const gif = decodeGif(encodeGif(frames))
    for (let f = 0; f < 2; f++) {
      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 60; x++) expect(pixel(gif.frames[f].image, x, y)[3]).toBe(frames[f].image.data[(y * 60 + x) * 4 + 3] === 0 ? 0 : 255)
      }
    }
  })

  test('the colour limit is respected', () => {
    for (const colors of [2, 16, 64]) {
      const back = decodeGif(encodeGif([{ image: frame(1), delay: 0 }], { colors })).frames[0].image
      expect(distinct(back)).toBeLessThanOrEqual(colors)
    }
  })

  test('a picture of 200 exact colours survives exactly (tables fill up and are cleared along the way)', () => {
    let s = 5
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff)
    const palette = Array.from({ length: 200 }, (_, i) => [(i % 25) * 8 + 8, Math.floor(i / 25) * 24 + 8, ((i * 37) % 31) * 8])
    const img = make(150, 150, () => [...palette[rnd() % 200], 255])
    const back = decodeGif(encodeGif([{ image: img, delay: 0 }], { dither: false })).frames[0].image
    expect(Array.from(back.data)).toEqual(Array.from(img.data))
  })

  test('one pixel, and two colours', () => {
    expect(pixel(decodeGif(encodeGif([{ image: make(1, 1, () => [9, 99, 199, 255]), delay: 0 }])).frames[0].image, 0, 0).slice(3)).toEqual([255])
    const two = make(8, 8, (x) => (x < 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
    expect(Array.from(decodeGif(encodeGif([{ image: two, delay: 0 }], { colors: 2, dither: false })).frames[0].image.data)).toEqual(Array.from(two.data))
  })

  test('frames of different sizes, or none, are refused', () => {
    expect(() => encodeGif([{ image: createImage(2, 2), delay: 0 }, { image: createImage(3, 2), delay: 0 }])).toThrow('same size')
    expect(() => encodeGif([])).toThrow('no frames')
  })
})

// ---------- BMP ----------

/** a bitmap with a 40-byte header, built by hand */
function bmp(o: { w: number; h: number; bpp: number; compression?: number; colors?: number; palette?: number[]; masks?: number[]; data: number[] }): Uint8Array {
  const masks = o.masks ?? []
  const palette = o.palette ?? []
  const off = 54 + masks.length * 4 + palette.length
  const b = new Uint8Array(off + o.data.length)
  const v = new DataView(b.buffer)
  b[0] = 0x42
  b[1] = 0x4d
  v.setUint32(2, b.length, true)
  v.setUint32(10, off, true)
  v.setUint32(14, 40, true)
  v.setInt32(18, o.w, true)
  v.setInt32(22, o.h, true)
  v.setUint16(26, 1, true)
  v.setUint16(28, o.bpp, true)
  v.setUint32(30, o.compression ?? 0, true)
  v.setUint32(46, o.colors ?? 0, true)
  masks.forEach((m, i) => v.setUint32(54 + i * 4, m, true))
  b.set(palette, 54 + masks.length * 4)
  b.set(o.data, off)
  return b
}

describe('decoding BMP', () => {
  test('8-bit palette, rows stored bottom up with padding', () => {
    // palette entries are blue, green, red, reserved
    const palette = [0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 10, 20, 30, 0]
    const img = decodeBmp(bmp({ w: 3, h: 2, bpp: 8, colors: 4, palette, data: [0, 1, 2, 0, 3, 2, 1, 0] }))
    expect([0, 1, 2].map((x) => pixel(img, x, 1))).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]])
    expect([0, 1, 2].map((x) => pixel(img, x, 0))).toEqual([[30, 20, 10, 255], [0, 0, 255, 255], [0, 255, 0, 255]])
  })

  test('4-bit and 1-bit palettes', () => {
    const pal4: number[] = []
    for (let i = 0; i < 16; i++) pal4.push(0, i * 16, 0, 0)
    const four = decodeBmp(bmp({ w: 5, h: 1, bpp: 4, colors: 16, palette: pal4, data: [0x01, 0x23, 0x40, 0] }))
    expect(Array.from({ length: 5 }, (_, x) => pixel(four, x, 0)[1])).toEqual([0, 16, 32, 48, 64])
    const one = decodeBmp(bmp({ w: 10, h: 1, bpp: 1, colors: 2, palette: [255, 0, 0, 0, 0, 0, 255, 0], data: [0b10101010, 0b11000000, 0, 0] }))
    // entry 0 is blue, entry 1 is red: the bits 1010101011 are red, blue, red, blue ...
    expect(Array.from({ length: 10 }, (_, x) => pixel(one, x, 0)[0])).toEqual([255, 0, 255, 0, 255, 0, 255, 0, 255, 255])
  })

  test('top-down 24-bit', () => {
    const img = decodeBmp(bmp({ w: 2, h: -2, bpp: 24, data: [10, 20, 30, 40, 50, 60, 0, 0, 70, 80, 90, 100, 110, 120, 0, 0] }))
    expect(pixel(img, 0, 0)).toEqual([30, 20, 10, 255])
    expect(pixel(img, 1, 1)).toEqual([120, 110, 100, 255])
  })

  test('16-bit with 565 masks, and the default 555', () => {
    const f565 = decodeBmp(bmp({ w: 3, h: 1, bpp: 16, compression: 3, masks: [0xf800, 0x07e0, 0x001f], data: [0, 0xf8, 0xe0, 0x07, 0x1f, 0, 0, 0] }))
    expect([0, 1, 2].map((x) => pixel(f565, x, 0))).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]])
    const f555 = decodeBmp(bmp({ w: 3, h: 1, bpp: 16, data: [0, 0x7c, 0xe0, 0x03, 0x1f, 0, 0, 0] }))
    expect([0, 1, 2].map((x) => pixel(f555, x, 0))).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]])
  })

  test('32-bit with unused (zero) alpha bytes is opaque', () => {
    const img = decodeBmp(bmp({ w: 2, h: 1, bpp: 32, data: [1, 2, 3, 0, 4, 5, 6, 0] }))
    expect([pixel(img, 0, 0), pixel(img, 1, 0)]).toEqual([[3, 2, 1, 255], [6, 5, 4, 255]])
  })

  test('RLE8 with runs and an absolute stretch', () => {
    const palette = [0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 255, 255, 0]
    // bottom row: three of index 1, one of index 2; then end of line; top row: absolute 0,1,2,3; end of bitmap
    const img = decodeBmp(bmp({ w: 4, h: 2, bpp: 8, compression: 1, colors: 5, palette, data: [3, 1, 1, 2, 0, 0, 0, 4, 0, 1, 2, 3, 0, 0, 0, 1] }))
    expect([0, 1, 2, 3].map((x) => pixel(img, x, 1).slice(0, 3))).toEqual([[0, 0, 255], [0, 0, 255], [0, 0, 255], [0, 255, 0]])
    expect([0, 1, 2, 3].map((x) => pixel(img, x, 0).slice(0, 3))).toEqual([[0, 0, 0], [0, 0, 255], [0, 255, 0], [255, 0, 0]])
  })

  test('RLE4 runs alternate between the two nibbles', () => {
    const pal: number[] = []
    for (let i = 0; i < 16; i++) pal.push(0, 0, i * 16, 0)
    const img = decodeBmp(bmp({ w: 4, h: 1, bpp: 4, compression: 2, colors: 16, palette: pal, data: [4, 0x12, 0, 0, 0, 1] }))
    expect(Array.from({ length: 4 }, (_, x) => pixel(img, x, 0)[0])).toEqual([16, 32, 16, 32])
  })

  test('refusals', () => {
    expect(() => decodeBmp(Uint8Array.from({ length: 40 }, () => 1))).toThrow("This isn't a BMP file.")
    expect(() => decodeBmp(bmp({ w: 2, h: 2, bpp: 24, data: [0, 0, 0] }))).toThrow('damaged')
    expect(() => decodeBmp(bmp({ w: 2, h: 2, bpp: 24, compression: 4, data: new Array(16).fill(0) }))).toThrow(UnsupportedImage)
    expect(() => decodeBmp(bmp({ w: 2, h: 2, bpp: 2, data: new Array(16).fill(0) }))).toThrow(UnsupportedImage)
  })
})

describe('writing BMP', () => {
  test('opaque pictures are 24 bit and exact; pictures with transparency are 32 bit and exact', () => {
    const opaque = make(13, 7, (x, y) => [x * 19, y * 35, (x * y * 7) & 255, 255])
    const bytes = encodeBmp(opaque)
    expect(bytes[28]).toBe(24)
    expect(Array.from(decodeBmp(bytes).data)).toEqual(Array.from(opaque.data))
    const clear = make(13, 7, (x, y) => [x * 19, y * 35, 99, (x * 20) & 255])
    const withAlpha = encodeBmp(clear)
    expect(withAlpha[28]).toBe(32)
    expect(Array.from(decodeBmp(withAlpha).data)).toEqual(Array.from(clear.data))
  })
})

// ---------- palettes ----------

describe('colour reduction', () => {
  const photo = make(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2, 255])

  test('the palette has at most the requested number of entries', () => {
    for (const n of [2, 8, 100, 256]) expect(buildPalette(photo, n).length / 4).toBeLessThanOrEqual(n)
  })

  test('two colours reduce exactly to those two', () => {
    const two = make(10, 10, (x) => (x < 5 ? [200, 30, 30, 255] : [20, 20, 220, 255]))
    const out = quantize(two, 2, false)
    expect(distinct(out)).toBe(2)
    expect(psnr(two, out)).toBeGreaterThan(40)
  })

  test('quantising keeps the colour count down and the picture recognisable', () => {
    const out = quantize(photo, 16)
    expect(distinct(out)).toBeLessThanOrEqual(16)
    expect(psnr(photo, out)).toBeGreaterThan(20) // dithering trades some PSNR for smoothness
    // more colours is closer
    expect(psnr(photo, quantize(photo, 128, false))).toBeGreaterThan(psnr(photo, quantize(photo, 8, false)))
  })

  test('dithering keeps the average colour of a flat area that falls between palette entries', () => {
    const grey = make(40, 40, () => [128, 128, 128, 255])
    const palette = Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255])
    const index = mapToPalette(grey, palette, true)
    const whites = index.reduce((n, i) => n + i, 0)
    expect(whites / index.length).toBeGreaterThan(0.4)
    expect(whites / index.length).toBeLessThan(0.6)
    expect(new Set(mapToPalette(grey, palette, false)).size).toBe(1)
  })

  test('transparent pixels go to the transparent index and are left out of the palette', () => {
    const img = make(4, 1, (x) => (x < 2 ? [9, 9, 9, 0] : [200, 100, 50, 255]))
    const palette = buildPalette(img, 4, 128)
    expect(palette.length / 4).toBe(1)
    const table = Uint8Array.from([...palette, 0, 0, 0, 0])
    expect(Array.from(mapToPalette(img, table, false, 1))).toEqual([1, 1, 0, 0])
  })

  test('a picture with no opaque pixels still gives a palette', () => {
    expect(buildPalette(make(2, 2, () => [1, 2, 3, 0]), 8, 128).length).toBe(4)
  })
})

// ---------- the codecs together ----------

describe('own codec', () => {
  const img = make(32, 24, (x, y) => [x * 8, y * 10, 120, 255])

  test.each(['image/png', 'image/jpeg', 'image/gif', 'image/bmp'] as const)('%s written by us is read by us', async (type) => {
    const bytes = await ownCodec.encode(img, type, 0.95)
    const back = await ownCodec.decode(bytes, type)
    expect([back.width, back.height]).toEqual([32, 24])
    expect(psnr(img, back)).toBeGreaterThan(type === 'image/png' || type === 'image/bmp' ? 90 : 28)
  })

  test('the file type is recognised by its bytes, not the declared type', async () => {
    const jpeg = encodeJpeg(img)
    expect((await ownCodec.decode(jpeg, 'image/png')).width).toBe(32)
    expect(decodeJpeg(jpeg).width).toBe(32)
  })

  test('WebP and unknown bytes are not ours to read, with a typed error the app can fall back on', async () => {
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    await expect(ownCodec.decode(webp, 'image/webp')).rejects.toBeInstanceOf(UnsupportedImage)
    await expect(ownCodec.encode(img, 'image/webp')).rejects.toThrow('only write')
  })

  test('the app codec shows our own message when the browser cannot read it either', async () => {
    const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    await expect(appCodec.decode(webp, 'image/webp')).rejects.toThrow("can't read that kind of image")
  })

  test('a damaged JPEG is not retried in the browser', async () => {
    await expect(appCodec.decode(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).rejects.toThrow('damaged')
  })

  test('JPEG with an EXIF orientation comes out upright', async () => {
    const jpeg = encodeJpeg(make(40, 24, () => [10, 20, 30, 255]), { quality: 90 })
    const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 8, 0, 0, 0, 0, 0, 0]
    const at = 2 + 2 + ((jpeg[4] << 8) | jpeg[5])
    const tagged = Uint8Array.from([...jpeg.subarray(0, at), 0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255, ...exif, ...jpeg.subarray(at)])
    const out = await ownCodec.decode(tagged, 'image/jpeg')
    expect([out.width, out.height]).toEqual([24, 40])
  })
})
