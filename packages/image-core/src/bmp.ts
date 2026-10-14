// Windows bitmaps: reading 1, 4, 8, 16, 24 and 32 bits per pixel (uncompressed, RLE or with bit masks) and writing 24 and 32 bit files.
import { UserError } from '@ream/core'
import { UnsupportedImage, checkPixels, createImage, type ImageBuffer } from './buffer.ts'

const DAMAGED = 'This BMP is damaged.'

/** where a colour mask's bits are: shift and bit count, so a value can be pulled out and scaled to 0..255 */
function maskInfo(mask: number): { shift: number; max: number } {
  if (!mask) return { shift: 0, max: 0 }
  let shift = 0
  while (!((mask >>> shift) & 1)) shift++
  let bits = 0
  while ((mask >>> (shift + bits)) & 1) bits++
  return { shift, max: 2 ** bits - 1 }
}

export function decodeBmp(d: Uint8Array): ImageBuffer {
  if (d.length < 26 || d[0] !== 0x42 || d[1] !== 0x4d) throw new UserError("This isn't a BMP file.")
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
  const dataAt = v.getUint32(10, true)
  const headerSize = v.getUint32(14, true)
  let w: number, h: number, planes: number, bpp: number, compression = 0, colorsUsed = 0
  let tableAt = 14 + headerSize
  let entrySize = 4
  if (headerSize === 12) {
    // OS/2 1.x: 16-bit sizes, three-byte palette entries
    w = v.getUint16(18, true)
    h = v.getUint16(20, true)
    planes = v.getUint16(22, true)
    bpp = v.getUint16(24, true)
    entrySize = 3
  } else if (headerSize >= 40) {
    w = v.getInt32(18, true)
    h = v.getInt32(22, true)
    planes = v.getUint16(26, true)
    bpp = v.getUint16(28, true)
    compression = v.getUint32(30, true)
    colorsUsed = v.getUint32(46, true)
  } else throw new UnsupportedImage('This BMP uses a header format that is not supported.')
  if (planes !== 1 || w === 0 || h === 0) throw new UserError(DAMAGED)
  const topDown = h < 0
  h = Math.abs(h)
  if (w < 0) throw new UserError(DAMAGED)
  checkPixels(w, h, 'This image is')
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new UnsupportedImage(`This BMP uses ${bpp} bits per pixel, which is not supported.`)
  if (compression > 3 && compression !== 6) throw new UnsupportedImage('This BMP is compressed with JPEG or PNG inside, which is not supported.')

  // colour masks for 16 and 32 bit files
  let masks = [0, 0, 0, 0]
  if (bpp === 16 || bpp === 32) {
    if (compression === 3 || compression === 6) {
      // the masks sit right after the first 40 bytes of the header, which in the larger headers (V4, V5) is where they are defined
      const at = 54
      masks = [v.getUint32(at, true), v.getUint32(at + 4, true), v.getUint32(at + 8, true), headerSize >= 56 || compression === 6 ? v.getUint32(at + 12, true) : 0]
      if (headerSize === 40) tableAt += compression === 6 ? 16 : 12
    } else masks = bpp === 16 ? [0x7c00, 0x03e0, 0x001f, 0] : [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000]
  }

  // palette
  const colors = bpp <= 8 ? colorsUsed || 1 << bpp : 0
  const palette = new Uint8Array(256 * 4)
  for (let i = 3; i < palette.length; i += 4) palette[i] = 255 // indices past the stored table are opaque black
  if (bpp <= 8) {
    for (let i = 0; i < Math.min(colors, 256); i++) {
      const p = tableAt + i * entrySize
      if (p + 3 > d.length) throw new UserError(DAMAGED)
      palette[i * 4] = d[p + 2]
      palette[i * 4 + 1] = d[p + 1]
      palette[i * 4 + 2] = d[p]
    }
  }

  const out = createImage(w, h)
  const rowOf = (y: number) => (topDown ? y : h - 1 - y)
  if (compression === 1 || compression === 2) {
    // run-length encoded 8 or 4 bit: a stream of (count, value) pairs and escapes; pixels not reached stay transparent
    let x = 0
    let y = 0
    let p = dataAt
    const put = (idx: number) => {
      if (x < w && y < h) out.data.set(palette.subarray(idx * 4, idx * 4 + 4), (rowOf(y) * w + x) * 4)
      x++
    }
    while (p + 1 < d.length && y < h) {
      const n = d[p++]
      const c = d[p++]
      if (n > 0) {
        for (let i = 0; i < n; i++) put(compression === 1 ? c : i & 1 ? c & 15 : c >> 4)
      } else if (c === 0) {
        x = 0
        y++
      } else if (c === 1) break
      else if (c === 2) {
        x += d[p++]
        y += d[p++]
      } else {
        // absolute run of c pixels, padded to a whole number of 16-bit words
        const bytes = compression === 1 ? c : (c + 1) >> 1
        for (let i = 0; i < c; i++) put(compression === 1 ? d[p + i] : i & 1 ? d[p + (i >> 1)] & 15 : d[p + (i >> 1)] >> 4)
        p += bytes + (bytes & 1)
      }
    }
    return out
  }

  const stride = ((w * bpp + 31) >> 5) * 4
  if (dataAt + stride * h > d.length) throw new UserError(DAMAGED)
  const [rm, gm, bm, am] = masks.map(maskInfo)
  const scale = (value: number, m: { max: number }) => (m.max === 255 ? value : m.max ? Math.round((value * 255) / m.max) : 0)
  let anyAlpha = false
  for (let y = 0; y < h; y++) {
    const row = dataAt + y * stride
    const o = rowOf(y) * w * 4
    for (let x = 0; x < w; x++) {
      const q = o + x * 4
      if (bpp <= 8) {
        const idx = bpp === 8 ? d[row + x] : (d[row + ((x * bpp) >> 3)] >> (8 - bpp - ((x * bpp) & 7))) & ((1 << bpp) - 1)
        out.data.set(palette.subarray(idx * 4, idx * 4 + 4), q)
      } else if (bpp === 24) {
        out.data[q] = d[row + x * 3 + 2]
        out.data[q + 1] = d[row + x * 3 + 1]
        out.data[q + 2] = d[row + x * 3]
        out.data[q + 3] = 255
      } else {
        const px = bpp === 16 ? v.getUint16(row + x * 2, true) : v.getUint32(row + x * 4, true)
        out.data[q] = scale((px >>> rm.shift) & rm.max, rm)
        out.data[q + 1] = scale((px >>> gm.shift) & gm.max, gm)
        out.data[q + 2] = scale((px >>> bm.shift) & bm.max, bm)
        const a = am.max ? scale((px >>> am.shift) & am.max, am) : 255
        out.data[q + 3] = a
        if (am.max && a) anyAlpha = true
      }
    }
  }
  // 32-bit files without an explicit alpha mask often hold zeros there: those are opaque, not invisible
  if (bpp === 32 && am.max && !anyAlpha) for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255
  return out
}

/** 24 bit for opaque pictures, 32 bit (BITMAPV4HEADER, with alpha) when something is transparent */
export function encodeBmp(img: ImageBuffer): Uint8Array {
  const { width: w, height: h, data } = img
  let alpha = false
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      alpha = true
      break
    }
  }
  const bpp = alpha ? 32 : 24
  const stride = ((w * bpp + 31) >> 5) * 4
  const header = alpha ? 108 : 40
  const dataAt = 14 + header
  const out = new Uint8Array(dataAt + stride * h)
  const v = new DataView(out.buffer)
  out[0] = 0x42
  out[1] = 0x4d
  v.setUint32(2, out.length, true)
  v.setUint32(10, dataAt, true)
  v.setUint32(14, header, true)
  v.setInt32(18, w, true)
  v.setInt32(22, h, true)
  v.setUint16(26, 1, true)
  v.setUint16(28, bpp, true)
  v.setUint32(30, alpha ? 3 : 0, true) // BI_BITFIELDS for the V4 header, BI_RGB otherwise
  v.setUint32(34, stride * h, true)
  v.setUint32(38, 2835, true) // 72 dpi
  v.setUint32(42, 2835, true)
  if (alpha) {
    v.setUint32(54, 0x00ff0000, true)
    v.setUint32(58, 0x0000ff00, true)
    v.setUint32(62, 0x000000ff, true)
    v.setUint32(66, 0xff000000, true)
    v.setUint32(70, 0x73524742, true) // 'sRGB'
  }
  for (let y = 0; y < h; y++) {
    const row = dataAt + (h - 1 - y) * stride
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const o = row + x * (bpp / 8)
      out[o] = data[i + 2]
      out[o + 1] = data[i + 1]
      out[o + 2] = data[i]
      if (alpha) out[o + 3] = data[i + 3]
    }
  }
  return out
}
