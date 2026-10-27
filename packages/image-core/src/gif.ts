// GIF 87a/89a: reading every frame of an animation (composited as a viewer shows them) and writing animations.
import { UserError } from '@ream/core'
import { checkPixels, createImage, type ImageBuffer } from './buffer.ts'
import { buildPalette, mapToPalette } from './quantize.ts'

export type GifFrame = {
  /** the whole canvas as it looks while this frame is shown */
  image: ImageBuffer
  /** how long it stays, in milliseconds (a file may say 0; viewers show those for 100 ms) */
  delay: number
}
export type Gif = { width: number; height: number; frames: GifFrame[]; /** 0 = forever */ loops: number }

const DAMAGED = 'This GIF is damaged.'
// all frames are kept as full RGBA canvases, so a long animation of a big picture is a lot of memory
const MAX_BYTES = 400 * 1024 * 1024

/** the sub-blocks starting at `at` joined together, and the position after the terminator */
function subBlocks(d: Uint8Array, at: number): [Uint8Array, number] {
  const parts: Uint8Array[] = []
  let n = 0
  while (at < d.length && d[at] !== 0) {
    const len = d[at]
    if (at + 1 + len > d.length) throw new UserError(DAMAGED)
    parts.push(d.subarray(at + 1, at + 1 + len))
    n += len
    at += 1 + len
  }
  const out = new Uint8Array(n)
  parts.reduce((o, p) => (out.set(p, o), o + p.length), 0)
  return [out, at + 1]
}

/** variable-width LZW as GIF uses it, least significant bit first */
function lzwDecode(data: Uint8Array, minSize: number, count: number): Uint8Array {
  const clear = 1 << minSize
  const eoi = clear + 1
  const prefix = new Uint16Array(4096)
  const suffix = new Uint8Array(4096)
  const stack = new Uint8Array(4097)
  const out = new Uint8Array(count)
  let size = minSize + 1
  let next = eoi + 1
  let prev = -1
  let first = 0
  let o = 0
  let buf = 0
  let bits = 0
  let at = 0
  while (o < count) {
    while (bits < size && at < data.length) {
      buf |= data[at++] << bits
      bits += 8
    }
    if (bits < size) break // ran out of data: what is decoded so far is kept
    const code = buf & ((1 << size) - 1)
    buf >>>= size
    bits -= size
    if (code === clear) {
      size = minSize + 1
      next = eoi + 1
      prev = -1
      continue
    }
    if (code === eoi) break
    if (prev < 0) {
      if (code >= clear) throw new UserError(DAMAGED)
      out[o++] = first = code
      prev = code
      continue
    }
    let c = code
    let sp = 0
    if (code >= next) {
      if (code > next) throw new UserError(DAMAGED)
      stack[sp++] = first // the string just before, plus its own first byte
      c = prev
    }
    while (c >= clear) {
      stack[sp++] = suffix[c]
      c = prefix[c]
    }
    first = c
    stack[sp++] = c
    while (sp > 0 && o < count) out[o++] = stack[--sp]
    if (next < 4096) {
      prefix[next] = prev
      suffix[next] = first
      next++
      if (next === 1 << size && size < 12) size++
    }
    prev = code
  }
  return out
}

/** Decode a GIF. With `firstOnly` only the first frame is read (what a single-picture codec needs); `maxFrames` stops after that many. */
export function decodeGif(d: Uint8Array, o: { firstOnly?: boolean; maxFrames?: number } = {}): Gif {
  if (d.length < 13 || String.fromCharCode(...d.subarray(0, 3)) !== 'GIF') throw new UserError("This isn't a GIF file.")
  const width = d[6] | (d[7] << 8)
  const height = d[8] | (d[9] << 8)
  if (!width || !height) throw new UserError(DAMAGED)
  checkPixels(width, height, 'This image is')
  let at = 13
  let globalTable: Uint8Array | null = null
  if (d[10] & 0x80) {
    const n = 3 << ((d[10] & 7) + 1)
    globalTable = d.subarray(at, at + n)
    at += n
  }
  const frames: GifFrame[] = []
  let loops = 1
  let canvas = createImage(width, height) // transparent, as browsers start
  // what the last frame asked for before the next one is drawn
  let disposal = 0
  let prevRect = [0, 0, 0, 0]
  let beforeFrame: Uint8ClampedArray | null = null
  // the graphic control extension that applies to the next frame
  let gce: { delay: number; transparent: number; disposal: number } | null = null

  while (at < d.length) {
    const b = d[at++]
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = d[at++]
      const [body, end] = subBlocks(d, at)
      at = end
      if (label === 0xf9 && body.length >= 4) gce = { delay: (body[1] | (body[2] << 8)) * 10, transparent: body[0] & 1 ? body[3] : -1, disposal: (body[0] >> 2) & 7 }
      else if (label === 0xff && body.length >= 14 && String.fromCharCode(...body.subarray(0, 11)) === 'NETSCAPE2.0' && body[11] === 1) loops = body[12] | (body[13] << 8)
      continue
    }
    if (b !== 0x2c) throw new UserError(DAMAGED)
    if (at + 9 > d.length) throw new UserError(DAMAGED)
    const fx = d[at] | (d[at + 1] << 8)
    const fy = d[at + 2] | (d[at + 3] << 8)
    const fw = d[at + 4] | (d[at + 5] << 8)
    const fh = d[at + 6] | (d[at + 7] << 8)
    const packed = d[at + 8]
    at += 9
    let table = globalTable
    if (packed & 0x80) {
      const n = 3 << ((packed & 7) + 1)
      table = d.subarray(at, at + n)
      at += n
    }
    const minSize = d[at++]
    if (minSize < 2 || minSize > 11) throw new UserError(DAMAGED)
    const [data, end] = subBlocks(d, at)
    at = end
    if (!table) throw new UserError(DAMAGED)
    if (fw === 0 || fh === 0) continue
    if ((frames.length + 1) * width * height * 4 > MAX_BYTES) throw new UserError('This GIF has too many frames for its size to open here.')

    // undo what the previous frame asked for
    if (disposal === 2) for (let y = prevRect[1]; y < Math.min(height, prevRect[1] + prevRect[3]); y++) canvas.data.fill(0, (y * width + prevRect[0]) * 4, (y * width + Math.min(width, prevRect[0] + prevRect[2])) * 4)
    else if (disposal === 3 && beforeFrame) canvas = { width, height, data: new Uint8ClampedArray(beforeFrame) }
    const g = gce ?? { delay: 0, transparent: -1, disposal: 0 }
    beforeFrame = g.disposal === 3 ? new Uint8ClampedArray(canvas.data) : null

    const idx = lzwDecode(data, minSize, fw * fh)
    const rows = (packed & 0x40) === 0 ? null : interlaceOrder(fh)
    for (let row = 0; row < fh; row++) {
      const y = fy + (rows ? rows[row] : row)
      if (y >= height) continue
      for (let x = 0; x < fw; x++) {
        if (fx + x >= width) break
        const c = idx[row * fw + x]
        if (c === g.transparent) continue
        const p = (y * width + fx + x) * 4
        canvas.data[p] = table[c * 3] ?? 0
        canvas.data[p + 1] = table[c * 3 + 1] ?? 0
        canvas.data[p + 2] = table[c * 3 + 2] ?? 0
        canvas.data[p + 3] = 255
      }
    }
    frames.push({ image: { width, height, data: new Uint8ClampedArray(canvas.data) }, delay: g.delay })
    disposal = g.disposal
    prevRect = [fx, fy, fw, fh]
    gce = null
    if (o.firstOnly || frames.length >= (o.maxFrames ?? Infinity)) break
  }
  if (!frames.length) throw new UserError(DAMAGED)
  return { width, height, frames, loops }
}

/** the display row each stored row of an interlaced frame belongs to */
function interlaceOrder(h: number): number[] {
  const out: number[] = []
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) out.push(y)
  return out
}

// ---------- writing ----------

/** a growing byte buffer (a plain array of numbers costs eight bytes per byte) */
class Bytes {
  private buf = new Uint8Array(1 << 16)
  n = 0
  push(...bytes: number[]) {
    this.ensure(bytes.length)
    for (const b of bytes) this.buf[this.n++] = b
  }
  append(b: Uint8Array) {
    this.ensure(b.length)
    this.buf.set(b, this.n)
    this.n += b.length
  }
  u16(v: number) {
    this.push(v & 255, (v >> 8) & 255)
  }
  private ensure(extra: number) {
    if (this.n + extra <= this.buf.length) return
    const bigger = new Uint8Array(Math.max(this.buf.length * 2, this.n + extra))
    bigger.set(this.buf.subarray(0, this.n))
    this.buf = bigger
  }
  result() {
    return this.buf.slice(0, this.n)
  }
}

const hasTransparency = (img: ImageBuffer) => {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 128) return true
  return false
}

export type GifOptions = {
  /** 0 = forever (default); -1 writes no loop block at all, so the animation plays once */
  loops?: number
  /** palette size per frame, 2 to 256 (default 256) */
  colors?: number
  /** error diffusion: smoother gradients, larger files (default true) */
  dither?: boolean
}

function lzwEncode(indices: Uint8Array, minSize: number): Uint8Array {
  const clear = 1 << minSize
  const eoi = clear + 1
  const out = new Bytes()
  let buf = 0
  let bits = 0
  const emit = (code: number, size: number) => {
    buf |= code << bits
    bits += size
    while (bits >= 8) {
      out.push(buf & 255)
      buf >>>= 8
      bits -= 8
    }
  }
  let size = minSize + 1
  let next = eoi + 1
  let dict = new Map<number, number>()
  emit(clear, size)
  let prefix = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]
    const key = (prefix << 8) | k
    const hit = dict.get(key)
    if (hit !== undefined) {
      prefix = hit
      continue
    }
    emit(prefix, size)
    if (next === 4096) {
      // the table is full: start over
      emit(clear, size)
      dict = new Map()
      size = minSize + 1
      next = eoi + 1
    } else {
      if (next >= 1 << size) size++
      dict.set(key, next++)
    }
    prefix = k
  }
  emit(prefix, size)
  emit(eoi, size)
  if (bits > 0) out.push(buf & 255)
  return out.result()
}

/**
 * Write an animation. Every frame has its own palette, so each can use its best 256 colours. When no frame has
 * transparency, a frame only stores the rectangle that changed since the one before.
 */
export function encodeGif(frames: { image: ImageBuffer; delay: number }[], o: GifOptions = {}): Uint8Array {
  if (!frames.length) throw new UserError('There are no frames to put in the GIF.')
  const { width, height } = frames[0].image
  if (width > 65535 || height > 65535) throw new UserError('GIF files can be at most 65535 pixels wide or high.')
  if (frames.some((f) => f.image.width !== width || f.image.height !== height)) throw new UserError('All frames of a GIF must be the same size.')
  const colors = Math.min(256, Math.max(2, Math.round(o.colors ?? 256)))
  const dither = o.dither ?? true
  const alpha = frames.some((f) => hasTransparency(f.image))
  const out = new Bytes()
  const u16 = (v: number) => out.u16(v)
  out.push(...Array.from('GIF89a', (c) => c.charCodeAt(0)))
  u16(width)
  u16(height)
  out.push(0, 0, 0) // no global table, background 0, no aspect ratio
  if (frames.length > 1 && o.loops !== -1) {
    out.push(0x21, 0xff, 11, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 3, 1)
    u16(o.loops ?? 0)
    out.push(0)
  }
  frames.forEach(({ image, delay }, fi) => {
    // the part of this frame that differs from the one before it
    let x0 = 0
    let y0 = 0
    let x1 = width
    let y1 = height
    let src = image
    if (!alpha && fi > 0) {
      const prev = frames[fi - 1].image.data
      let minX = width
      let minY = height
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = (y * width + x) * 4
          if (image.data[p] !== prev[p] || image.data[p + 1] !== prev[p + 1] || image.data[p + 2] !== prev[p + 2]) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      // nothing changed: one pixel keeps the delay
      if (maxX < 0) [minX, minY, maxX, maxY] = [0, 0, 0, 0]
      ;[x0, y0, x1, y1] = [minX, minY, maxX + 1, maxY + 1]
    }
    const fw = x1 - x0
    const fh = y1 - y0
    if (fw !== width || fh !== height) {
      src = createImage(fw, fh)
      for (let y = 0; y < fh; y++) src.data.set(image.data.subarray(((y0 + y) * width + x0) * 4, ((y0 + y) * width + x0 + fw) * 4), y * fw * 4)
    }
    // palette (an entry is kept free for transparency when the animation has any)
    const palette = buildPalette(src, alpha ? colors - 1 : colors, alpha ? 128 : 0)
    let n = palette.length / 4
    let transparent = -1
    let table = palette
    if (alpha) {
      transparent = n
      table = new Uint8Array((n + 1) * 4)
      table.set(palette)
      n++
    }
    const index = mapToPalette(src, table, dither, transparent)
    const sizeBits = Math.max(1, Math.ceil(Math.log2(n)))
    const tableSize = 1 << sizeBits
    out.push(0x21, 0xf9, 4, (alpha ? 2 << 2 : 1 << 2) | (alpha ? 1 : 0)) // dispose: clear to background with transparency, else leave
    u16(Math.round(delay / 10))
    out.push(Math.max(0, transparent), 0)
    out.push(0x2c)
    u16(x0)
    u16(y0)
    u16(fw)
    u16(fh)
    out.push(0x80 | (sizeBits - 1))
    for (let i = 0; i < tableSize; i++) out.push(table[i * 4] ?? 0, table[i * 4 + 1] ?? 0, table[i * 4 + 2] ?? 0)
    const minSize = Math.max(2, sizeBits)
    out.push(minSize)
    const data = lzwEncode(index, minSize)
    for (let at = 0; at < data.length; at += 255) {
      const chunk = data.subarray(at, at + 255)
      out.push(chunk.length)
      out.append(chunk)
    }
    out.push(0)
  })
  out.push(0x3b)
  return out.result()
}
