import { UserError, crc32, deflate, inflate, pngPredictor } from '@ream/core'
import { checkPixels, createImage, type ImageBuffer } from './buffer.ts'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
// Adam7: first column, first row, column step, row step of each of the seven passes
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
]

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
  if (!(color in CHANNELS) || ![1, 2, 4, 8, 16].includes(depth) || w < 1 || h < 1 || hdr.interlace > 1) throw new UserError('This PNG uses a format that is not supported.')
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
  const mask = (1 << Math.min(depth, 8)) - 1
  const out = createImage(w, h)

  /** unpack `ph` filtered rows of `pw` pixels starting at `raw[off]`; `place(x, y)` gives the pixel's offset in the output */
  const unpack = (off: number, pw: number, ph: number, place: (x: number, y: number) => number) => {
    const rowBytes = (channels * depth * pw + 7) >> 3
    if (raw.length < off + ph * (rowBytes + 1)) throw new UserError('This PNG is damaged.')
    const px = pngPredictor(raw.subarray(off, off + ph * (rowBytes + 1)), pw, channels, depth)
    // the common photos and screenshots, straight across (no interlacing: the place of a pixel is its index)
    if (!hdr.interlace && depth === 8 && color === 6) return out.data.set(px)
    if (!hdr.interlace && depth === 8 && color === 2 && !trns) {
      for (let i = 0, o = 0; i < px.length; i += 3, o += 4) {
        out.data[o] = px[i]
        out.data[o + 1] = px[i + 1]
        out.data[o + 2] = px[i + 2]
        out.data[o + 3] = 255
      }
      return
    }
    for (let y = 0; y < ph; y++) {
      const row = y * rowBytes
      // one sample (0 .. 2^depth-1; 16-bit keeps its high byte)
      const sample = (i: number) =>
        depth === 8 ? px[row + i] : depth === 16 ? px[row + 2 * i] : (px[row + ((i * depth) >> 3)] >> (8 - depth - ((i * depth) & 7))) & mask
      const to8 = (s: number) => (depth >= 8 ? s : Math.round((s * 255) / mask))
      for (let x = 0; x < pw; x++) {
        const o = place(x, y)
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
          r = sample(x * channels)
          g = sample(x * channels + 1)
          b = sample(x * channels + 2)
          if (color === 6) a = sample(x * 4 + 3)
          else if (trns && depth === 8 && r === trns[1] && g === trns[3] && b === trns[5]) a = 0
        }
        out.data[o] = r
        out.data[o + 1] = g
        out.data[o + 2] = b
        out.data[o + 3] = a
      }
    }
  }

  if (!hdr.interlace) unpack(0, w, h, (x, y) => (y * w + x) * 4)
  else {
    let off = 0
    for (const [x0, y0, dx, dy] of ADAM7) {
      const pw = Math.ceil((w - x0) / dx)
      const ph = Math.ceil((h - y0) / dy)
      if (pw < 1 || ph < 1) continue // small pictures have empty passes
      unpack(off, pw, ph, (x, y) => ((y0 + y * dy) * w + x0 + x * dx) * 4)
      off += ph * (((channels * depth * pw + 7) >> 3) + 1)
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

/**
 * Filter each row with whichever of the five PNG filters leaves the smallest sum of absolute values (libpng's heuristic),
 * `bpp` being the bytes per complete pixel (at least 1). Rows are `stride` bytes, in `pixels`.
 */
export function filterRows(pixels: Uint8Array, stride: number, height: number, bpp: number, filters: number[]): Uint8Array {
  const out = new Uint8Array((stride + 1) * height)
  const tries = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride))
  const zero = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const cur = pixels.subarray(y * stride, (y + 1) * stride)
    const up = y ? pixels.subarray((y - 1) * stride, y * stride) : zero
    let best = 0
    let bestCost = Infinity
    for (const ft of filters) {
      const t = tries[ft]
      let cost = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0
        const b = up[i]
        let p = 0
        if (ft === 1) p = a
        else if (ft === 2) p = b
        else if (ft === 3) p = (a + b) >> 1
        else if (ft === 4) {
          const c = i >= bpp ? up[i - bpp] : 0
          const q = a + b - c
          const pa = Math.abs(q - a)
          const pb = Math.abs(q - b)
          const pc = Math.abs(q - c)
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        }
        const d = (cur[i] - p) & 255
        t[i] = d
        cost += d < 128 ? d : 256 - d
      }
      if (cost < bestCost) {
        bestCost = cost
        best = ft
      }
    }
    out[y * (stride + 1)] = best
    out.set(tries[best], y * (stride + 1) + 1)
  }
  return out
}

export type PngOptions = {
  /** pick the smallest lossless form: palette, grey or RGB instead of always RGBA, and the best filter per row (default true) */
  optimize?: boolean
  /** complete chunks to write after the header (colour profile, density: see `colourChunks`) */
  chunks?: Uint8Array[]
}

type Layout = { color: number; depth: number; plte?: Uint8Array; trns?: Uint8Array; pixels: Uint8Array; stride: number; bpp: number }

/** the pixel bytes of the picture in the smallest PNG colour layout that holds it exactly */
function layoutOf(img: ImageBuffer, optimize: boolean, allowPalette = true): Layout {
  const { width: w, height: h, data } = img
  const n = w * h
  const rgba = (): Layout => ({ color: 6, depth: 8, pixels: new Uint8Array(data.buffer, data.byteOffset, data.length), stride: w * 4, bpp: 4 })
  if (!optimize) return rgba()

  let alpha = false
  let grey = true
  // up to 256 distinct colours are kept, as r, g, b, a packed into one number
  const index = new Map<number, number>()
  let many = false
  // neighbours mostly share a colour (pages, screenshots): the map is only asked when it changes
  let last = -1
  // a pixel the same as the one before tells nothing new (a 32-bit view compares it in one go, when the bytes are aligned)
  const same = data.byteOffset % 4 === 0 ? new Uint32Array(data.buffer, data.byteOffset, n) : null
  for (let i = 0; i < n; i++) {
    if (same && i && same[i] === same[i - 1]) continue
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3]
    if (a !== 255) alpha = true
    if (r !== g || r !== b) grey = false
    if (!many) {
      const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0
      if (key !== last && !index.has(key)) {
        if (index.size === 256) many = true
        else index.set(key, index.size)
      }
      last = key
    } else if (alpha && !grey) break // nothing left to learn
  }

  // a palette pays off up to 256 colours, except for plain grey with many levels (grey8 has no palette to store)
  if (allowPalette && !many && !(grey && !alpha && index.size > 16)) {
    const entries = [...index.keys()]
    // transparent entries first, so the tRNS chunk only has to list those
    entries.sort((p, q) => (p & 255) - (q & 255))
    const slot = new Map(entries.map((k, i) => [k, i]))
    const plte = new Uint8Array(entries.length * 3)
    const trnsFull = new Uint8Array(entries.length)
    entries.forEach((k, i) => {
      plte[i * 3] = k >>> 24
      plte[i * 3 + 1] = (k >>> 16) & 255
      plte[i * 3 + 2] = (k >>> 8) & 255
      trnsFull[i] = k & 255
    })
    let lastTrans = -1
    trnsFull.forEach((a, i) => a !== 255 && (lastTrans = i))
    const depth = entries.length <= 2 ? 1 : entries.length <= 4 ? 2 : entries.length <= 16 ? 4 : 8
    const stride = (w * depth + 7) >> 3
    const pixels = new Uint8Array(stride * h)
    let lastKey = -1
    let k = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const key = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0
        if (key !== lastKey) {
          k = slot.get(key)!
          lastKey = key
        }
        if (depth === 8) pixels[y * stride + x] = k
        else pixels[y * stride + ((x * depth) >> 3)] |= k << (8 - depth - ((x * depth) & 7))
      }
    }
    return { color: 3, depth, plte, trns: lastTrans >= 0 ? trnsFull.subarray(0, lastTrans + 1) : undefined, pixels, stride, bpp: 1 }
  }
  if (grey) {
    const ch = alpha ? 2 : 1
    const pixels = new Uint8Array(n * ch)
    for (let i = 0; i < n; i++) {
      pixels[i * ch] = data[i * 4]
      if (alpha) pixels[i * ch + 1] = data[i * 4 + 3]
    }
    return { color: alpha ? 4 : 0, depth: 8, pixels, stride: w * ch, bpp: ch }
  }
  if (!alpha) {
    const pixels = new Uint8Array(n * 3)
    for (let i = 0; i < n; i++) pixels.set(data.subarray(i * 4, i * 4 + 3), i * 3)
    return { color: 2, depth: 8, pixels, stride: w * 3, bpp: 3 }
  }
  return rgba()
}

async function write(img: ImageBuffer, l: Layout, optimize: boolean, chunks: Uint8Array[]): Promise<Uint8Array> {
  // ponytail: the filter heuristic is libpng's, and deflate is the platform's (zlib level 6); a tighter deflate of our own would save a few percent more
  // packed pixels (depth < 8) don't filter well, so those rows go unfiltered, as in libpng
  const filters = !optimize ? [1] : l.depth === 8 ? [0, 1, 2, 3, 4] : [0]
  const filtered = filterRows(l.pixels, l.stride, img.height, l.bpp, filters)
  const ihdr = new Uint8Array(13)
  const hv = new DataView(ihdr.buffer)
  hv.setUint32(0, img.width)
  hv.setUint32(4, img.height)
  ihdr[8] = l.depth
  ihdr[9] = l.color
  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr), ...chunks]
  if (l.plte) parts.push(chunk('PLTE', l.plte))
  if (l.trns) parts.push(chunk('tRNS', l.trns))
  parts.push(chunk('IDAT', await deflate(filtered)), chunk('IEND', new Uint8Array(0)))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}

/** Encode a picture. Without `optimize: false` the result is the smallest lossless PNG this encoder can make. */
export async function encodePng(img: ImageBuffer, o: PngOptions = {}): Promise<Uint8Array> {
  const optimize = o.optimize ?? true
  const l = layoutOf(img, optimize)
  const best = await write(img, l, optimize, o.chunks ?? [])
  // a palette costs 3 bytes a colour, which a small picture with many colours can't earn back: try the plain form too
  if (optimize && l.color === 3 && l.plte!.length > 48 && img.width * img.height <= 262144) {
    const plain = await write(img, layoutOf(img, optimize, false), optimize, o.chunks ?? [])
    if (plain.length < best.length) return plain
  }
  return best
}
