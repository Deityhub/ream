// A baseline JPEG encoder: JFIF, YCbCr (4:4:4 or 4:2:0) or greyscale, optionally with Huffman tables built for the
// picture itself, which is smaller than the standard ones at the same quality.
import { UserError } from '@ream/core'
import type { ImageBuffer } from '../buffer.ts'
import { fdct } from './dct.ts'
import { BASE_CHROMA, BASE_LUMA, STD_AC_CHROMA, STD_AC_LUMA, STD_DC_CHROMA, STD_DC_LUMA, ZIGZAG, type HuffSpec } from './tables.ts'

export type JpegOptions = {
  /** 1 to 100, default 90 */
  quality?: number
  /** colour resolution: full (4:4:4), half across (4:2:2) or half across and down (4:2:0). Default: 4:2:0 below quality 90, 4:4:4 from there */
  subsampling?: '444' | '422' | '420'
  /** MCUs between restart markers, 0 for none (default). Lets a damaged file recover; costs a little size */
  restartInterval?: number
  /** tables built from this picture's own statistics (default true) */
  optimize?: boolean
  /** one component (true) or three (false) whatever the pixels are; by default a picture whose pixels are all grey is stored as grey */
  grey?: boolean
  /** complete APPn segments (marker and length included) to keep, written after the JFIF header */
  segments?: Uint8Array[]
}

/** libjpeg's quality scaling of the Annex K tables, in natural order */
export function quantTable(base: Uint8Array, quality: number): Int32Array {
  const q = Math.min(100, Math.max(1, Math.round(quality)))
  const scale = q < 50 ? 5000 / q : 200 - 2 * q
  return Int32Array.from(base, (b) => Math.min(255, Math.max(1, Math.floor((b * scale + 50) / 100))))
}

// ---------- Huffman tables ----------

type Codes = { code: Uint16Array; size: Uint8Array }

function codesOf(spec: HuffSpec): Codes {
  const code = new Uint16Array(256)
  const size = new Uint8Array(256)
  let c = 0
  let k = 0
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < spec.counts[len - 1]; i++, k++) {
      code[spec.symbols[k]] = c++
      size[spec.symbols[k]] = len
    }
    c <<= 1
  }
  return { code, size }
}

/** T.81 K.2: the shortest code lengths for these symbol counts, limited to 16 bits, with the all-ones code left unused */
export function optimalTable(freqIn: Uint32Array | number[]): HuffSpec {
  const freq = new Float64Array(257)
  for (let i = 0; i < 256; i++) freq[i] = freqIn[i] ?? 0
  freq[256] = 1 // reserved symbol, so that no real symbol gets the all-ones code
  const size = new Int32Array(257)
  const others = new Int32Array(257).fill(-1)
  for (;;) {
    let c1 = -1
    let v = Infinity
    for (let i = 0; i <= 256; i++) if (freq[i] && freq[i] <= v) (v = freq[i]), (c1 = i)
    let c2 = -1
    v = Infinity
    for (let i = 0; i <= 256; i++) if (freq[i] && freq[i] <= v && i !== c1) (v = freq[i]), (c2 = i)
    if (c2 < 0) break
    freq[c1] += freq[c2]
    freq[c2] = 0
    size[c1]++
    while (others[c1] >= 0) size[(c1 = others[c1])]++
    others[c1] = c2
    size[c2]++
    while (others[c2] >= 0) size[(c2 = others[c2])]++
  }
  const bits = new Int32Array(33)
  for (let i = 0; i <= 256; i++) if (size[i]) bits[Math.min(32, size[i])]++
  // no code may be longer than 16 bits: move the deepest pair up a level until it fits
  for (let i = 32; i > 16; i--) {
    while (bits[i] > 0) {
      let j = i - 2
      while (bits[j] === 0) j--
      bits[i] -= 2
      bits[i - 1]++
      bits[j + 1] += 2
      bits[j]--
    }
  }
  let i = 16
  while (bits[i] === 0) i--
  bits[i]-- // the reserved symbol's code
  const symbols: number[] = []
  for (let len = 1; len <= 32; len++) for (let s = 0; s < 256; s++) if (size[s] === len) symbols.push(s)
  return { counts: Uint8Array.from({ length: 16 }, (_, k) => bits[k + 1]), symbols: Uint8Array.from(symbols) }
}

// ---------- bit output ----------

class Out {
  buf = new Uint8Array(1 << 16)
  n = 0
  private acc = 0
  private cnt = 0
  byte(b: number) {
    if (this.n === this.buf.length) {
      const bigger = new Uint8Array(this.buf.length * 2)
      bigger.set(this.buf)
      this.buf = bigger
    }
    this.buf[this.n++] = b
  }
  put(value: number, len: number) {
    if (len === 0) return
    this.acc = (this.acc << len) | (value & ((1 << len) - 1))
    this.cnt += len
    while (this.cnt >= 8) {
      const b = (this.acc >>> (this.cnt - 8)) & 255
      this.byte(b)
      if (b === 255) this.byte(0)
      this.cnt -= 8
    }
    this.acc &= (1 << this.cnt) - 1
  }
  /** pad the last byte with ones */
  flush() {
    if (this.cnt) this.put(0x7f, 8 - this.cnt)
  }
  bytes(b: Uint8Array | number[]) {
    for (const x of b) this.byte(x)
  }
  u16(v: number) {
    this.byte(v >> 8)
    this.byte(v & 255)
  }
  result() {
    return this.buf.slice(0, this.n)
  }
}

// ---------- the encoder ----------

type Plane = { data: Uint8Array; w: number; h: number }

const bitLength = (v: number) => (v === 0 ? 0 : 32 - Math.clz32(v))

/** Encode as a baseline JPEG. Transparency is ignored; flatten the picture first. */
export function encodeJpeg(img: ImageBuffer, o: JpegOptions = {}): Uint8Array {
  const { width, height } = img
  if (width > 65535 || height > 65535) throw new UserError('JPEG files can be at most 65535 pixels wide or high.')
  const quality = o.quality ?? 90
  const px = img.data
  const n = width * height

  let grey = o.grey ?? true
  if (o.grey === undefined) for (let i = 0; i < n * 4 && grey; i += 4) grey = px[i] === px[i + 1] && px[i] === px[i + 2]
  const sub = grey ? '444' : (o.subsampling ?? (quality < 90 ? '420' : '444'))
  const hs = sub === '444' ? 1 : 2
  const vs = sub === '420' ? 2 : 1
  const mcusX = Math.ceil(width / (8 * hs))
  const mcusY = Math.ceil(height / (8 * vs))
  const fw = mcusX * 8 * hs
  const fh = mcusY * 8 * vs

  // full-size planes padded to whole MCUs by repeating the last row and column
  const planes: Float32Array[] = grey ? [new Float32Array(fw * fh)] : [new Float32Array(fw * fh), new Float32Array(fw * fh), new Float32Array(fw * fh)]
  for (let y = 0; y < fh; y++) {
    const sy = Math.min(y, height - 1)
    for (let x = 0; x < fw; x++) {
      const i = (sy * width + Math.min(x, width - 1)) * 4
      const r = px[i]
      const g = px[i + 1]
      const b = px[i + 2]
      const at = y * fw + x
      if (grey) planes[0][at] = r
      else {
        planes[0][at] = 0.299 * r + 0.587 * g + 0.114 * b
        planes[1][at] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128
        planes[2][at] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128
      }
    }
  }
  const toPlane = (f: Float32Array, sx: number, sy: number): Plane => {
    const w = fw / sx
    const h = fh / sy
    const data = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0
        for (let dy = 0; dy < sy; dy++) for (let dx = 0; dx < sx; dx++) s += f[(y * sy + dy) * fw + x * sx + dx]
        data[y * w + x] = Math.min(255, Math.max(0, Math.round(s / (sx * sy))))
      }
    }
    return { data, w, h }
  }
  const comps = planes.map((f, i) => ({ plane: i === 0 ? toPlane(f, 1, 1) : toPlane(f, hs, vs), h: i === 0 ? hs : 1, v: i === 0 ? vs : 1, table: i === 0 ? 0 : 1 }))

  // quantised blocks in zigzag order, one array per component, stored in raster order of the component's blocks
  const qLuma = quantTable(BASE_LUMA, quality)
  const qChroma = quantTable(BASE_CHROMA, quality)
  const coef = new Float32Array(64)
  const blocks = comps.map((c) => {
    const bw = c.plane.w / 8
    const bh = c.plane.h / 8
    const q = c.table === 0 ? qLuma : qChroma
    const out = new Int16Array(bw * bh * 64)
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        fdct(c.plane.data, by * 8 * c.plane.w + bx * 8, c.plane.w, coef)
        const base = (by * bw + bx) * 64
        for (let k = 0; k < 64; k++) {
          const i = ZIGZAG[k]
          out[base + k] = Math.round(coef[i] / q[i])
        }
      }
    }
    return { bw, out }
  })

  // every block in the order the scan visits them, as [component, offset]
  const restart = o.restartInterval ?? 0
  const visit = (fn: (table: number, c: number, off: number) => void, boundary?: (n: number) => void) => {
    for (let my = 0; my < mcusY; my++) {
      for (let mx = 0; mx < mcusX; mx++) {
        if (restart && boundary && (my * mcusX + mx) % restart === 0 && my * mcusX + mx > 0) boundary((my * mcusX + mx) / restart - 1)
        comps.forEach((c, ci) => {
          for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) fn(c.table, ci, ((my * c.v + v) * blocks[ci].bw + mx * c.h + h) * 64)
        })
      }
    }
  }

  // the symbols of one block: DC difference size, then run/size pairs, with the extra bits that follow each
  type Sink = {
    dc(table: number, size: number, extra: number): void
    ac(table: number, symbol: number, size: number, extra: number): void
    /** a restart marker goes here (its number counts up) */
    restart?(n: number): void
  }
  const pred = new Int32Array(comps.length)
  const code = (sink: Sink) => {
    pred.fill(0)
    visit((table, ci, off) => {
      const b = blocks[ci].out
      const diff = b[off] - pred[ci]
      pred[ci] = b[off]
      const s = bitLength(Math.abs(diff))
      sink.dc(table, s, diff < 0 ? diff + (1 << s) - 1 : diff)
      let run = 0
      for (let k = 1; k < 64; k++) {
        const v = b[off + k]
        if (v === 0) {
          run++
          continue
        }
        for (; run > 15; run -= 16) sink.ac(table, 0xf0, 0, 0)
        const size = bitLength(Math.abs(v))
        sink.ac(table, (run << 4) | size, size, v < 0 ? v + (1 << size) - 1 : v)
        run = 0
      }
      if (run > 0) sink.ac(table, 0x00, 0, 0)
    }, (n) => {
      pred.fill(0)
      sink.restart?.(n)
    })
  }

  const tables = grey ? 1 : 2
  let dcSpecs = [STD_DC_LUMA, STD_DC_CHROMA].slice(0, tables)
  let acSpecs = [STD_AC_LUMA, STD_AC_CHROMA].slice(0, tables)
  if (o.optimize ?? true) {
    const dcFreq = Array.from({ length: tables }, () => new Uint32Array(256))
    const acFreq = Array.from({ length: tables }, () => new Uint32Array(256))
    code({
      dc: (t, s) => dcFreq[t][s]++,
      ac: (t, sym) => acFreq[t][sym]++,
    })
    dcSpecs = dcFreq.map(optimalTable)
    acSpecs = acFreq.map(optimalTable)
  }
  const dcCodes = dcSpecs.map(codesOf)
  const acCodes = acSpecs.map(codesOf)

  const out = new Out()
  out.u16(0xffd8)
  // JFIF 1.01, no density
  out.bytes([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])
  for (const s of o.segments ?? []) out.bytes(s)
  const tablesOut = grey ? [qLuma] : [qLuma, qChroma]
  tablesOut.forEach((q, id) => {
    out.u16(0xffdb)
    out.u16(67)
    out.byte(id)
    for (let k = 0; k < 64; k++) out.byte(q[ZIGZAG[k]])
  })
  if (restart) {
    out.u16(0xffdd)
    out.u16(4)
    out.u16(restart)
  }
  out.u16(0xffc0)
  out.u16(8 + comps.length * 3)
  out.byte(8)
  out.u16(height)
  out.u16(width)
  out.byte(comps.length)
  comps.forEach((c, i) => out.bytes([i + 1, (c.h << 4) | c.v, c.table]))
  const dht = (cls: number, id: number, s: HuffSpec) => {
    out.u16(0xffc4)
    out.u16(19 + s.symbols.length)
    out.byte((cls << 4) | id)
    out.bytes(s.counts)
    out.bytes(s.symbols)
  }
  for (let t = 0; t < tables; t++) {
    dht(0, t, dcSpecs[t])
    dht(1, t, acSpecs[t])
  }
  out.u16(0xffda)
  out.u16(6 + comps.length * 2)
  out.byte(comps.length)
  comps.forEach((c, i) => out.bytes([i + 1, (c.table << 4) | c.table]))
  out.bytes([0, 63, 0])
  code({
    dc(t, s, extra) {
      out.put(dcCodes[t].code[s], dcCodes[t].size[s])
      out.put(extra, s)
    },
    ac(t, sym, s, extra) {
      out.put(acCodes[t].code[sym], acCodes[t].size[sym])
      out.put(extra, s)
    },
    restart(n) {
      out.flush()
      out.u16(0xffd0 + (n & 7))
    },
  })
  out.flush()
  out.u16(0xffd9)
  return out.result()
}
