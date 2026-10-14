import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { UserError } from '@ream/core'
import { createImage, decodeJpeg, decodePng, encodeJpeg, orient, ownCodec, type ImageBuffer } from '../src/index.ts'
import { optimalTable, quantTable } from '../src/jpeg/encode.ts'
import { BASE_LUMA, STD_AC_CHROMA, STD_AC_LUMA, STD_DC_CHROMA, STD_DC_LUMA } from '../src/jpeg/tables.ts'

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))

/** a smooth picture with a hard-edged disc, in colour, or grey */
function picture(w: number, h: number, grey = false): ImageBuffer {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const disc = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (Math.min(w, h) / 3) ** 2
      const r = disc ? 230 : (x * 200) / w + 20
      img.data[i] = r
      img.data[i + 1] = grey ? r : disc ? 70 : (y * 200) / h + 20
      img.data[i + 2] = grey ? r : disc ? 40 : 160 - (x * 100) / w
      img.data[i + 3] = 255
    }
  }
  return img
}

const psnr = (a: ImageBuffer, b: ImageBuffer) => {
  let s = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      s += (a.data[i + c] - b.data[i + c]) ** 2
      n++
    }
  }
  return s === 0 ? Infinity : 10 * Math.log10(255 ** 2 / (s / n))
}
const maxDiff = (a: ImageBuffer, b: ImageBuffer) => {
  let m = 0
  for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[i + c] - b.data[i + c]))
  return m
}

/** the marker segments of a JPEG up to the scan: [marker, bytes of the segment's body] */
function segments(b: Uint8Array): [number, Uint8Array][] {
  const out: [number, Uint8Array][] = []
  for (let i = 2; i + 3 < b.length; ) {
    const m = b[i + 1]
    const len = (b[i + 2] << 8) | b[i + 3]
    out.push([m, b.subarray(i + 4, i + 2 + len)])
    if (m === 0xda) break
    i += 2 + len
  }
  return out
}
const sof = (b: Uint8Array) => segments(b).find(([m]) => m >= 0xc0 && m <= 0xc2)![1]

describe('decoding files made by other encoders (reference: Chromium)', () => {
  // the reference pictures are what libjpeg-turbo gives; implementations differ by a level or two in the IDCT
  test('baseline 4:2:0 from macOS', async () => {
    const got = decodeJpeg(fixture('photo-420.jpg'))
    const ref = await decodePng(fixture('photo-420.ref.png'))
    expect([got.width, got.height]).toEqual([96, 64])
    expect(maxDiff(got, ref)).toBeLessThanOrEqual(3)
  })

  test('four-component Adobe CMYK', async () => {
    const got = decodeJpeg(fixture('cmyk.jpg'))
    const ref = await decodePng(fixture('cmyk.ref.png'))
    expect(maxDiff(got, ref)).toBeLessThanOrEqual(3)
  })

  test('progressive, all ten scans of the libjpeg script (spectral selection and successive approximation)', () => {
    const got = decodeJpeg(fixture('progressive.jpg'))
    const ref = JSON.parse(readFileSync(new URL('./fixtures/progressive.ref.json', import.meta.url), 'utf8')) as { width: number; height: number; cell: number; cols: number; rgb: number[] }
    expect([got.width, got.height]).toEqual([ref.width, ref.height])
    let worst = 0
    for (let c = 0; c < ref.rgb.length / 3; c++) {
      const cx = c % ref.cols
      const cy = Math.floor(c / ref.cols)
      const sum = [0, 0, 0]
      let n = 0
      for (let y = cy * ref.cell; y < Math.min(got.height, (cy + 1) * ref.cell); y++) {
        for (let x = cx * ref.cell; x < Math.min(got.width, (cx + 1) * ref.cell); x++) {
          for (let k = 0; k < 3; k++) sum[k] += got.data[(y * got.width + x) * 4 + k]
          n++
        }
      }
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(Math.round(sum[k] / n) - ref.rgb[c * 3 + k]))
    }
    expect(worst).toBeLessThanOrEqual(1)
  })
})

describe('encoder', () => {
  const src = picture(203, 117)

  test.each([
    ['4:4:4', { quality: 95, subsampling: '444' as const }, 40],
    ['4:2:2', { quality: 90, subsampling: '422' as const }, 36],
    ['4:2:0', { quality: 90, subsampling: '420' as const }, 34],
    ['restart markers', { quality: 90, subsampling: '420' as const, restartInterval: 5 }, 34],
    ['standard tables', { quality: 90, optimize: false }, 34],
  ])('%s round-trips through our own decoder', (_name, o, minPsnr) => {
    const bytes = encodeJpeg(src, o)
    const back = decodeJpeg(bytes)
    expect([back.width, back.height]).toEqual([203, 117])
    expect(psnr(src, back)).toBeGreaterThan(minPsnr)
  })

  test('sampling factors and restart interval are written to the header', () => {
    const f = (o: Parameters<typeof encodeJpeg>[1]) => sof(encodeJpeg(src, o))
    // SOF body: precision, height(2), width(2), n, then (id, sampling, table) per component
    expect(f({ subsampling: '420' })[7]).toBe(0x22)
    expect(f({ subsampling: '422' })[7]).toBe(0x21)
    expect(f({ subsampling: '444' })[7]).toBe(0x11)
    expect(f({ subsampling: '420' })[10]).toBe(0x11)
    const dri = segments(encodeJpeg(src, { restartInterval: 7 })).find(([m]) => m === 0xdd)
    expect(dri && (dri[1][0] << 8) | dri[1][1]).toBe(7)
  })

  test('a grey picture is stored with one component, and is smaller', () => {
    const grey = picture(120, 80, true)
    const bytes = encodeJpeg(grey, { quality: 90 })
    expect(sof(bytes)[5]).toBe(1)
    expect(sof(encodeJpeg(picture(120, 80), { quality: 90 }))[5]).toBe(3)
    const back = decodeJpeg(bytes)
    expect(psnr(grey, back)).toBeGreaterThan(38)
  })

  test('tables built for the picture are smaller than the standard ones and give the same pixels', () => {
    const std = encodeJpeg(src, { quality: 80, optimize: false })
    const opt = encodeJpeg(src, { quality: 80, optimize: true })
    expect(opt.length).toBeLessThan(std.length)
    expect(decodeJpeg(opt).data).toEqual(decodeJpeg(std).data)
  })

  test('lower quality is smaller, higher quality is closer', () => {
    const sizes = [20, 60, 95].map((q) => encodeJpeg(src, { quality: q }).length)
    expect(sizes[0]).toBeLessThan(sizes[1])
    expect(sizes[1]).toBeLessThan(sizes[2])
    expect(psnr(src, decodeJpeg(encodeJpeg(src, { quality: 95 })))).toBeGreaterThan(psnr(src, decodeJpeg(encodeJpeg(src, { quality: 20 }))))
  })

  test.each([
    [1, 1],
    [7, 9],
    [17, 31],
    [8, 8],
    [9, 1],
  ])('%i x %i pixel pictures (partial blocks and MCUs)', (w, h) => {
    const img = picture(w, h)
    for (const subsampling of ['444', '422', '420'] as const) {
      const back = decodeJpeg(encodeJpeg(img, { quality: 95, subsampling }))
      expect([back.width, back.height]).toEqual([w, h])
      // chroma is shared between pixels in 4:2:2 and 4:2:0, which a hard edge can't survive; full-resolution colour is close
      if (subsampling === '444') expect(maxDiff(img, back)).toBeLessThan(24)
    }
  })

  test('JFIF header and extra segments are kept, in order', () => {
    const exif = Uint8Array.from([0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0])
    const parts = segments(encodeJpeg(src, { segments: [exif] }))
    expect(parts.map(([m]) => m).slice(0, 3)).toEqual([0xe0, 0xe1, 0xdb])
  })

  test('refuses sizes JPEG cannot hold', () => {
    expect(() => encodeJpeg({ width: 70000, height: 1, data: new Uint8ClampedArray(0) })).toThrow(UserError)
  })
})

describe('tables', () => {
  test('quality scaling follows libjpeg', () => {
    expect(Array.from(quantTable(BASE_LUMA, 50))).toEqual(Array.from(BASE_LUMA))
    expect(quantTable(BASE_LUMA, 90)[0]).toBe(3)
    expect(quantTable(BASE_LUMA, 100).every((v) => v === 1)).toBe(true)
    expect(quantTable(BASE_LUMA, 1).every((v) => v === 255)).toBe(true)
  })

  test('the standard Huffman tables are complete', () => {
    for (const t of [STD_AC_LUMA, STD_AC_CHROMA]) {
      expect(t.symbols.length).toBe(162)
      expect(t.counts.reduce((a, b) => a + b, 0)).toBe(162)
      // every run (0-15) and size (1-10), plus end-of-block and sixteen zeros
      const want = new Set<number>([0x00, 0xf0])
      for (let r = 0; r < 16; r++) for (let s = 1; s <= 10; s++) want.add((r << 4) | s)
      expect(new Set(t.symbols)).toEqual(want)
    }
    for (const t of [STD_DC_LUMA, STD_DC_CHROMA]) expect(Array.from(t.symbols)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  test('optimal tables are valid prefix codes that never use the all-ones code, even for skewed counts', () => {
    const fib = [1, 1]
    for (let i = 2; i < 40; i++) fib.push(fib[i - 1] + fib[i - 2])
    for (const freq of [[5, 3, 1], fib, Array.from({ length: 256 }, (_, i) => i + 1), [7]]) {
      const t = optimalTable(freq)
      expect(t.symbols.length).toBe(freq.length)
      expect(t.counts.reduce((a, b) => a + b, 0)).toBe(freq.length)
      let kraft = 0
      t.counts.forEach((c, i) => (kraft += c / 2 ** (i + 1)))
      expect(kraft).toBeLessThan(1) // strictly: the all-ones code is spare
    }
    // the more frequent symbol never gets the longer code
    const t = optimalTable([100, 1, 50])
    expect(t.symbols[0]).toBe(0)
  })
})

describe('orientation', () => {
  /** a 3x2 picture whose pixel (x, y) is marked by its red value */
  const marked = () => {
    const img = createImage(3, 2)
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) img.data.set([y * 3 + x + 1, 0, 0, 255], (y * 3 + x) * 4)
    return img
  }
  // where the source pixel (x, y) of a w x h picture ends up
  const where: Record<number, (x: number, y: number, w: number, h: number) => [number, number]> = {
    1: (x, y) => [x, y],
    2: (x, y, w) => [w - 1 - x, y],
    3: (x, y, w, h) => [w - 1 - x, h - 1 - y],
    4: (x, y, _w, h) => [x, h - 1 - y],
    5: (x, y) => [y, x],
    6: (x, y, _w, h) => [h - 1 - y, x],
    7: (x, y, w, h) => [h - 1 - y, w - 1 - x],
    8: (x, y, w) => [y, w - 1 - x],
  }

  test.each([1, 2, 3, 4, 5, 6, 7, 8])('EXIF value %i', (o) => {
    const src = marked()
    const out = orient(src, o)
    expect([out.width, out.height]).toEqual(o >= 5 ? [2, 3] : [3, 2])
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 3; x++) {
        const [dx, dy] = where[o](x, y, 3, 2)
        expect(out.data[(dy * out.width + dx) * 4]).toBe(src.data[(y * 3 + x) * 4])
      }
    }
  })

  /** insert an EXIF segment with this orientation after the JFIF header */
  function withOrientation(jpeg: Uint8Array, value: number): Uint8Array {
    const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, value, 0, 0, 0, 0, 0, 0]
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
    const seg = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]
    const at = 2 + 2 + ((jpeg[4] << 8) | jpeg[5]) // after SOI and the JFIF segment
    return Uint8Array.from([...jpeg.subarray(0, at), ...seg, ...jpeg.subarray(at)])
  }

  test('the decoder reports the tag; our codec turns the picture upright like a browser does', async () => {
    const jpeg = withOrientation(encodeJpeg(picture(40, 24), { quality: 95, subsampling: '444' }), 6)
    expect(decodeJpeg(jpeg).orientation).toBe(6)
    expect(decodeJpeg(encodeJpeg(picture(40, 24))).orientation).toBe(1)
    const upright = await ownCodec.decode(jpeg, 'image/jpeg')
    expect([upright.width, upright.height]).toEqual([24, 40])
  })
})

describe('damaged and unsupported files', () => {
  const good = encodeJpeg(picture(160, 96), { quality: 85, subsampling: '420' })

  test('not a JPEG', () => {
    expect(() => decodeJpeg(Uint8Array.from([1, 2, 3, 4, 5]))).toThrow("This isn't a JPEG file.")
  })

  test('nothing after the start marker', () => {
    expect(() => decodeJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow('damaged')
  })

  test('12-bit, arithmetic and lossless files get a clear refusal', () => {
    const twelve = good.slice()
    const at = twelve.findIndex((b, i) => b === 0xff && twelve[i + 1] === 0xc0)
    twelve[at + 4] = 12
    expect(() => decodeJpeg(twelve)).toThrow('12-bit')
    for (const [marker, word] of [[0xc9, 'arithmetic'], [0xc3, 'lossless']] as const) {
      const other = good.slice()
      other[at + 1] = marker
      expect(() => decodeJpeg(other)).toThrow(word)
    }
  })

  test('a file cut off in the middle shows the part it has and leaves the rest grey', () => {
    const full = decodeJpeg(good)
    const scan = good.findIndex((b, i) => b === 0xff && good[i + 1] === 0xda)
    const cut = good.subarray(0, scan + Math.floor((good.length - scan) * 0.5))
    const part = decodeJpeg(cut)
    expect([part.width, part.height]).toEqual([160, 96])
    // the top rows are as in the full decode, the bottom ones are mid-grey
    const row = (img: ImageBuffer, y: number) => Array.from(img.data.subarray(y * 160 * 4, (y + 1) * 160 * 4))
    expect(row(part, 2)).toEqual(row(full, 2))
    expect(row(part, 95).every((v, i) => (i % 4 === 3 ? v === 255 : v === 128))).toBe(true)
  })

  test('cut off before any picture data', () => {
    const scan = good.findIndex((b, i) => b === 0xff && good[i + 1] === 0xda)
    expect(() => decodeJpeg(good.subarray(0, scan + 14))).toThrow('damaged')
  })

  test('with restart markers a damaged stretch costs only its own interval', () => {
    const bytes = encodeJpeg(picture(160, 96), { quality: 85, subsampling: '444', restartInterval: 2 })
    const clean = decodeJpeg(bytes)
    const damaged = bytes.slice()
    const scan = damaged.findIndex((b, i) => b === 0xff && damaged[i + 1] === 0xda)
    // scramble a few bytes of entropy data well inside the file
    const mid = scan + 60 + Math.floor((damaged.length - scan - 60) * 0.3)
    for (let i = 0; i < 6; i++) damaged[mid + i] ^= 0xa5
    const got = decodeJpeg(damaged)
    expect([got.width, got.height]).toEqual([160, 96])
    // the last rows come after the damage and a restart marker, so they are untouched
    const rowOf = (img: ImageBuffer, y: number) => Array.from(img.data.subarray(y * 160 * 4, (y + 1) * 160 * 4))
    expect(rowOf(got, 95)).toEqual(rowOf(clean, 95))
    expect(got.data).not.toEqual(clean.data)
  })
})
