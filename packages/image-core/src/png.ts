import { UserError, crc32, deflate, inflate, pngPredictor } from '@ream/core'
import { checkPixels, createImage, type ImageBuffer } from './buffer.ts'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export async function decodePng(bytes: Uint8Array): Promise<ImageBuffer> {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new UserError("This isn't a PNG file.")
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let hdr: { w: number; h: number; depth: number; color: number; interlace: number } | null = null
  let plte: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idat: Uint8Array[] = []
  for (let at = 8; at + 8 <= bytes.length; ) {
    const len = v.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + len)
    at += 12 + len
    if (type === 'IHDR' && len >= 13) {
      const d = new DataView(data.buffer, data.byteOffset, data.byteLength)
      hdr = { w: d.getUint32(0), h: d.getUint32(4), depth: data[8], color: data[9], interlace: data[12] }
    } else if (type === 'PLTE') plte = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
  }
  if (!hdr || !idat.length) throw new UserError('This PNG is damaged.')
  const { w, h, depth, color } = hdr
  if (!(color in CHANNELS) || ![1, 2, 4, 8, 16].includes(depth) || w < 1 || h < 1) throw new UserError('This PNG uses a format that is not supported.')
  if (hdr.interlace) throw new UserError('Interlaced PNGs are not supported by this decoder yet.')
  checkPixels(w, h, 'This image is')

  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0))
  idat.reduce((at, c) => (joined.set(c, at), at + c.length), 0)
  let raw: Uint8Array
  try {
    raw = await inflate(joined)
  } catch {
    throw new UserError('This PNG is damaged.')
  }
  const channels = CHANNELS[color]
  const rowBytes = (channels * depth * w + 7) >> 3
  if (raw.length < h * (rowBytes + 1)) throw new UserError('This PNG is damaged.')
  const px = pngPredictor(raw, w, channels, depth)

  const out = createImage(w, h)
  const mask = (1 << Math.min(depth, 8)) - 1
  for (let y = 0; y < h; y++) {
    const row = y * rowBytes
    // one sample (0 .. 2^depth-1; 16-bit keeps its high byte)
    const sample = (i: number) =>
      depth === 8 ? px[row + i] : depth === 16 ? px[row + 2 * i] : (px[row + ((i * depth) >> 3)] >> (8 - depth - ((i * depth) & 7))) & mask
    const to8 = (s: number) => (depth >= 8 ? s : Math.round((s * 255) / mask))
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      let r: number, g: number, b: number, a = 255
      if (color === 3) {
        const idx = sample(x)
        r = plte?.[idx * 3] ?? 0
        g = plte?.[idx * 3 + 1] ?? 0
        b = plte?.[idx * 3 + 2] ?? 0
        a = trns && idx < trns.length ? trns[idx] : 255
      } else if (color === 0 || color === 4) {
        const s = sample(x * channels)
        r = g = b = to8(s)
        if (color === 4) a = to8(sample(x * 2 + 1))
        // ponytail: colour-key transparency (tRNS) is honoured for depths up to 8 only
        else if (trns && depth < 16 && s === trns[1]) a = 0
      } else {
        const s = [sample(x * channels), sample(x * channels + 1), sample(x * channels + 2)]
        r = s[0]
        g = s[1]
        b = s[2]
        if (color === 6) a = sample(x * 4 + 3)
        else if (trns && depth === 8 && s[0] === trns[1] && s[1] === trns[3] && s[2] === trns[5]) a = 0
      }
      out.data[o] = r
      out.data[o + 1] = g
      out.data[o + 2] = b
      out.data[o + 3] = a
    }
  }
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** 8-bit RGBA, no interlacing */
export async function encodePng(img: ImageBuffer): Promise<Uint8Array> {
  const stride = img.width * 4
  const raw = new Uint8Array((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    const r = y * (stride + 1)
    raw[r] = 1 // ponytail: Sub filter on every row; choosing the best filter per row comes with the M4 PNG optimiser
    for (let i = 0; i < stride; i++) raw[r + 1 + i] = img.data[y * stride + i] - (i >= 4 ? img.data[y * stride + i - 4] : 0)
  }
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, img.width)
  hv.setUint32(4, img.height)
  ihdr[8] = 8
  ihdr[9] = 6
  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}
