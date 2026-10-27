// A JPEG decoder: baseline, extended-sequential and progressive Huffman files, 8 bits per sample, one to four
// components, any sampling factors, restart intervals. Arithmetic coding, lossless and 12-bit files are refused.
import { UserError } from '@ream/core'
import { UnsupportedImage, checkPixels, createImage, type ImageBuffer } from '../buffer.ts'
import { idct } from './dct.ts'
import { tiffOrientation } from './orientation.ts'
import { ZIGZAG } from './tables.ts'

const DAMAGED = 'This JPEG is damaged.'

type Huff = { look: Uint16Array; maxcode: Int32Array; valptr: Int32Array; mincode: Int32Array; symbols: Uint8Array }

function buildHuff(counts: Uint8Array, symbols: Uint8Array): Huff {
  const look = new Uint16Array(256) // (length << 8 | symbol) for codes up to 8 bits, 0 for longer ones
  const maxcode = new Int32Array(17).fill(-1)
  const valptr = new Int32Array(17)
  const mincode = new Int32Array(17)
  let code = 0
  let k = 0
  for (let len = 1; len <= 16; len++) {
    valptr[len] = k
    mincode[len] = code
    for (let i = 0; i < counts[len - 1]; i++, k++, code++) {
      if (len <= 8) {
        const base = code << (8 - len)
        for (let j = 0; j < 1 << (8 - len) && base + j < 256; j++) look[base + j] = (len << 8) | symbols[k]
      }
    }
    if (counts[len - 1]) maxcode[len] = code - 1
    code <<= 1
  }
  return { look, maxcode, valptr, mincode, symbols }
}

/** the data ran out or went wrong inside a scan; `at` is how many MCUs of the scan were read before that */
class Truncated extends Error {
  at: number
  constructor(at: number) {
    super('truncated')
    this.at = at
  }
}
/** a bit pattern that is no code of the table (raised inside the bit reader, turned into Truncated by the scan loop) */
class Corrupt extends Error {}

/** reads bits from entropy-coded data, undoing 0xFF00 stuffing and stopping at the next marker (zeros after it) */
class Bits {
  buf = 0
  cnt = 0
  atMarker = false
  readonly d: Uint8Array
  pos: number
  constructor(d: Uint8Array, pos: number) {
    this.d = d
    this.pos = pos
  }

  private fill() {
    while (this.cnt <= 24) {
      let b = 0
      if (!this.atMarker && this.pos < this.d.length) {
        b = this.d[this.pos]
        if (b === 0xff) {
          const n = this.d[this.pos + 1]
          if (n === 0) this.pos += 2
          else {
            this.atMarker = true
            b = 0
            this.over++
          }
        } else this.pos++
      } else this.over++
      this.buf = (this.buf << 8) | b
      this.cnt += 8
    }
  }
  /** zero bytes fed past the end of the file; a lot of them means the data was cut off */
  over = 0

  bits(n: number): number {
    if (n === 0) return 0
    this.fill()
    this.cnt -= n
    return (this.buf >>> this.cnt) & ((1 << n) - 1)
  }
  bit(): number {
    return this.bits(1)
  }
  /** receive and sign-extend (T.81 F.2.2.1) */
  extend(t: number): number {
    if (t === 0) return 0
    const v = this.bits(t)
    return v < 1 << (t - 1) ? v - (1 << t) + 1 : v
  }
  symbol(h: Huff): number {
    this.fill()
    const hit = h.look[(this.buf >>> (this.cnt - 8)) & 255]
    if (hit) {
      this.cnt -= hit >> 8
      return hit & 255
    }
    for (let len = 9; len <= 16; len++) {
      const code = (this.buf >>> (this.cnt - len)) & ((1 << len) - 1)
      if (h.maxcode[len] >= 0 && code <= h.maxcode[len]) {
        this.cnt -= len
        return h.symbols[h.valptr[len] + code - h.mincode[len]] ?? 0
      }
    }
    throw new Corrupt()
  }
  /** after a restart interval or at the end of a scan: drop leftover bits and move to the next marker */
  alignToMarker(): number {
    this.cnt = 0
    this.buf = 0
    if (!this.atMarker) {
      // skip to the next real marker (the rest of this segment is padding or damage)
      while (this.pos + 1 < this.d.length && !(this.d[this.pos] === 0xff && this.d[this.pos + 1] !== 0 && this.d[this.pos + 1] !== 0xff)) this.pos++
    }
    return this.pos
  }
  /** move to the next marker and consume it if it is a restart marker; returns its number (0..7), or -1 when it is something else */
  restart(): number {
    const at = this.alignToMarker()
    this.atMarker = false
    this.over = 0
    const m = this.d[at + 1]
    if (this.d[at] === 0xff && m >= 0xd0 && m <= 0xd7) {
      this.pos = at + 2
      return m - 0xd0
    }
    this.pos = at
    return -1
  }
}

type Comp = {
  id: number
  h: number
  v: number
  tq: number
  /** real size in blocks, and the size rounded up to whole MCUs (what is stored) */
  bw: number
  bh: number
  bwPad: number
  bhPad: number
  /** samples of this component, padded to whole MCUs, filled in as blocks are decoded or at the end (progressive) */
  plane: Uint8Array
  coefs: Int16Array | null
  pred: number
  dc: Huff | null
  ac: Huff | null
}

export type JpegPixels = ImageBuffer & {
  /** EXIF orientation 1..8 as found in the file (the pixels are not turned) */
  orientation: number
  /** colour components in the file: 1 grey, 3 colour, 4 CMYK */
  components: number
}

const SOF_UNSUPPORTED: Record<number, string> = {
  0xc3: 'lossless',
  0xc5: 'hierarchical',
  0xc6: 'hierarchical',
  0xc7: 'hierarchical',
  0xc9: 'arithmetic-coded',
  0xca: 'arithmetic-coded',
  0xcb: 'arithmetic-coded',
  0xcd: 'arithmetic-coded',
  0xce: 'arithmetic-coded',
  0xcf: 'arithmetic-coded',
}

/** Decode to RGBA. The orientation is reported, not applied (see `orient`). */
export function decodeJpeg(d: Uint8Array): JpegPixels {
  if (d.length < 4 || d[0] !== 0xff || d[1] !== 0xd8) throw new UserError("This isn't a JPEG file.")
  const qt: (Int32Array | null)[] = [null, null, null, null] // natural order
  const dcTables: (Huff | null)[] = [null, null, null, null]
  const acTables: (Huff | null)[] = [null, null, null, null]
  let comps: Comp[] = []
  let width = 0
  let height = 0
  let progressive = false
  let mcusX = 0
  let mcusY = 0
  let hmax = 1
  let vmax = 1
  let restartInterval = 0
  let orientation = 1
  let adobe = -1 // transform byte of the Adobe marker, -1 when there is none
  let jfif = false
  let scans = 0

  let pos = 2
  loop: while (pos + 1 < d.length) {
    if (d[pos] !== 0xff) {
      pos++
      continue
    }
    const m = d[pos + 1]
    if (m === 0xff) {
      pos++
      continue
    }
    pos += 2
    if (m === 0 || m === 0x01 || (m >= 0xd0 && m <= 0xd8)) continue
    if (m === 0xd9) break
    if (pos + 2 > d.length) break
    const len = (d[pos] << 8) | d[pos + 1]
    const seg = pos + 2
    const end = pos + len
    if (len < 2 || end > d.length) break
    if (m === 0xdb) {
      for (let p = seg; p < end; ) {
        const pq = d[p] >> 4
        const t = d[p] & 15
        p++
        if (t > 3 || p + (pq ? 128 : 64) > end) throw new UserError(DAMAGED)
        const table = new Int32Array(64)
        for (let k = 0; k < 64; k++) table[ZIGZAG[k]] = pq ? (d[p + 2 * k] << 8) | d[p + 2 * k + 1] : d[p + k]
        qt[t] = table
        p += pq ? 128 : 64
      }
    } else if (m === 0xc4) {
      for (let p = seg; p + 17 <= end; ) {
        const tc = d[p] >> 4
        const th = d[p] & 15
        const counts = d.subarray(p + 1, p + 17)
        const total = counts.reduce((a, b) => a + b, 0)
        if (th > 3 || total > 256 || p + 17 + total > end) throw new UserError(DAMAGED)
        const h = buildHuff(counts, d.subarray(p + 17, p + 17 + total))
        ;(tc === 0 ? dcTables : acTables)[th] = h
        p += 17 + total
      }
    } else if (m === 0xdd) {
      restartInterval = (d[seg] << 8) | d[seg + 1]
    } else if (m === 0xe1 && len >= 14 && d[seg] === 0x45 && d[seg + 1] === 0x78 && d[seg + 2] === 0x69 && d[seg + 3] === 0x66) {
      orientation = tiffOrientation(d, seg + 6, end)
    } else if (m === 0xe0 && len >= 7 && d[seg] === 0x4a && d[seg + 1] === 0x46 && d[seg + 2] === 0x49 && d[seg + 3] === 0x46) {
      jfif = true
    } else if (m === 0xee && len >= 14 && d[seg] === 0x41 && d[seg + 1] === 0x64 && d[seg + 2] === 0x6f && d[seg + 3] === 0x62 && d[seg + 4] === 0x65) {
      adobe = d[seg + 11]
    } else if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      if (comps.length) throw new UnsupportedImage('This JPEG has more than one frame, which is not supported.')
      progressive = m === 0xc2
      if (d[seg] !== 8) throw new UnsupportedImage(`This JPEG uses ${d[seg]}-bit samples, which are not supported.`)
      height = (d[seg + 1] << 8) | d[seg + 2]
      width = (d[seg + 3] << 8) | d[seg + 4]
      const n = d[seg + 5]
      if (!width || !height) throw height ? new UserError(DAMAGED) : new UnsupportedImage('This JPEG does not give its height in the header, which is not supported.')
      if (n < 1 || n > 4 || seg + 6 + n * 3 > end) throw new UserError(DAMAGED)
      checkPixels(width, height, 'This image is')
      for (let i = 0; i < n; i++) {
        const p = seg + 6 + i * 3
        const h = d[p + 1] >> 4
        const v = d[p + 1] & 15
        if (h < 1 || h > 4 || v < 1 || v > 4) throw new UserError(DAMAGED)
        comps.push({ id: d[p], h, v, tq: d[p + 2], bw: 0, bh: 0, bwPad: 0, bhPad: 0, plane: new Uint8Array(0), coefs: null, pred: 0, dc: null, ac: null })
        hmax = Math.max(hmax, h)
        vmax = Math.max(vmax, v)
      }
      mcusX = Math.ceil(width / (8 * hmax))
      mcusY = Math.ceil(height / (8 * vmax))
      for (const c of comps) {
        c.bw = Math.ceil(Math.ceil((width * c.h) / hmax) / 8)
        c.bh = Math.ceil(Math.ceil((height * c.v) / vmax) / 8)
        c.bwPad = mcusX * c.h
        c.bhPad = mcusY * c.v
        c.plane = new Uint8Array(c.bwPad * 8 * c.bhPad * 8).fill(128)
        if (progressive) c.coefs = new Int16Array(c.bwPad * c.bhPad * 64)
      }
    } else if (SOF_UNSUPPORTED[m]) {
      throw new UnsupportedImage(`This JPEG is ${SOF_UNSUPPORTED[m]}, which is not supported.`)
    } else if (m === 0xda) {
      if (!comps.length) throw new UserError(DAMAGED)
      const ns = d[seg]
      if (ns < 1 || ns > 4 || seg + 1 + ns * 2 + 3 > end) throw new UserError(DAMAGED)
      const inScan: Comp[] = []
      for (let i = 0; i < ns; i++) {
        const c = comps.find((x) => x.id === d[seg + 1 + i * 2])
        if (!c) throw new UserError(DAMAGED)
        c.dc = dcTables[d[seg + 2 + i * 2] >> 4] ?? null
        c.ac = acTables[d[seg + 2 + i * 2] & 15] ?? null
        inScan.push(c)
      }
      const ss = d[seg + 1 + ns * 2]
      const se = d[seg + 2 + ns * 2]
      const ah = d[seg + 3 + ns * 2] >> 4
      const al = d[seg + 3 + ns * 2] & 15
      if (progressive ? ss > se || se > 63 || (ss === 0 && se !== 0) : false) throw new UserError(DAMAGED)
      try {
        pos = decodeScan(d, end, inScan, progressive ? { ss, se, ah, al } : null)
      } catch (e) {
        // a cut-off file shows what it has; the rest stays mid-grey
        if (!(e instanceof Truncated)) throw e
        if (scans === 0 && e.at === 0) throw new UserError(DAMAGED)
        scans++
        break loop
      }
      scans++
      continue
    }
    pos = end
  }
  if (!comps.length || !scans) throw new UserError(DAMAGED)

  function decodeScan(data: Uint8Array, from: number, inScan: Comp[], prog: { ss: number; se: number; ah: number; al: number } | null): number {
    const bits = new Bits(data, from)
    // a scan with no data at all: the file stops right after its header
    if (scans === 0 && (from + 1 >= data.length || (data[from] === 0xff && data[from + 1] !== 0))) throw new UserError(DAMAGED)
    for (const c of inScan) {
      if (!qt[c.tq] && !progressive) throw new UserError(DAMAGED)
      if (!prog) {
        if (!c.dc || !c.ac) throw new UserError(DAMAGED)
      } else if (prog.ss === 0 ? prog.ah === 0 && !c.dc : !c.ac) throw new UserError(DAMAGED)
      c.pred = 0
    }
    let eobrun = 0
    const scratch = new Int16Array(64)

    const decodeBlock = (c: Comp, row: number, col: number) => {
      const target = prog ? c.coefs! : scratch
      const off = prog ? (row * c.bwPad + col) * 64 : 0
      if (!prog) {
        target.fill(0)
        const t = bits.symbol(c.dc!)
        c.pred += bits.extend(t)
        scratch[0] = c.pred
        for (let k = 1; k < 64; ) {
          const rs = bits.symbol(c.ac!)
          const s = rs & 15
          const r = rs >> 4
          if (s === 0) {
            if (r < 15) break
            k += 16
            continue
          }
          k += r
          if (k > 63) break
          scratch[ZIGZAG[k]] = bits.extend(s)
          k++
        }
        idct(scratch, 0, qt[c.tq]!, c.plane, row * 8 * c.bwPad * 8 + col * 8, c.bwPad * 8)
        return
      }
      const { ss, se, ah, al } = prog
      if (ss === 0) {
        if (ah === 0) {
          c.pred += bits.extend(bits.symbol(c.dc!))
          target[off] = c.pred * (1 << al)
        } else if (bits.bit()) target[off] |= 1 << al
        return
      }
      if (ah === 0) {
        if (eobrun > 0) {
          eobrun--
          return
        }
        for (let k = ss; k <= se; ) {
          const rs = bits.symbol(c.ac!)
          const s = rs & 15
          const r = rs >> 4
          if (s === 0) {
            if (r < 15) {
              eobrun = bits.bits(r) + (1 << r) - 1
              break
            }
            k += 16
            continue
          }
          k += r
          if (k > 63) break
          target[off + ZIGZAG[k]] = bits.extend(s) * (1 << al)
          k++
        }
        return
      }
      // refinement of the AC bits already sent (libjpeg's decode_mcu_AC_refine)
      const p1 = 1 << al
      const m1 = -1 << al
      let k = ss
      const refine = (i: number) => {
        const v = target[i]
        if (bits.bit() && (v & p1) === 0) target[i] = v + (v >= 0 ? p1 : m1)
      }
      if (eobrun === 0) {
        for (; k <= se; k++) {
          const rs = bits.symbol(c.ac!)
          let r = rs >> 4
          let s = rs & 15
          if (s) s = bits.bit() ? p1 : m1
          else if (r !== 15) {
            eobrun = 1 << r
            if (r) eobrun += bits.bits(r)
            break
          }
          do {
            const i = off + ZIGZAG[k]
            if (target[i] !== 0) refine(i)
            else if (--r < 0) break
            k++
          } while (k <= se)
          if (s && k <= se) target[off + ZIGZAG[k]] = s
        }
      }
      if (eobrun > 0) {
        for (; k <= se; k++) {
          const i = off + ZIGZAG[k]
          if (target[i] !== 0) refine(i)
        }
        eobrun--
      }
    }

    // MCUs in raster order: a scan of one component walks that component's own blocks, several walk interleaved MCUs
    const single = inScan.length === 1
    const total = single ? inScan[0].bw * inScan[0].bh : mcusX * mcusY
    let sinceRestart = 0
    let nextRst = 0
    for (let n = 0; n < total; n++) {
      if (restartInterval && sinceRestart === restartInterval) {
        for (;;) {
          const m = bits.restart()
          if (m < 0) break
          const ahead = (m - nextRst) & 7
          // a marker from before the one we expect is left over from a damaged stretch: look for the next one
          if (ahead >= 6) continue
          // one or two markers ahead: the intervals in between were lost, so their MCUs stay as they are
          if (ahead === 1 || ahead === 2) n += ahead * restartInterval
          nextRst = (m + 1) & 7
          break
        }
        if (n >= total) break
        for (const c of inScan) c.pred = 0
        eobrun = 0
        sinceRestart = 0
      }
      if (bits.over > 8) {
        // out of data: the file ends here, unless a restart marker is what stopped us, then only this interval is lost
        if (!(restartInterval && bits.atMarker)) throw new Truncated(n)
        sinceRestart = restartInterval
        continue
      }
      try {
        if (single) {
          const c = inScan[0]
          decodeBlock(c, Math.floor(n / c.bw), n % c.bw)
        } else {
          const my = Math.floor(n / mcusX)
          const mx = n % mcusX
          for (const c of inScan) for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) decodeBlock(c, my * c.v + v, mx * c.h + h)
        }
      } catch (e) {
        if (!(e instanceof Corrupt)) throw e
        // with restart markers the damage stays inside one interval: leave the rest of it as it is and carry on at the next
        if (!restartInterval) throw new Truncated(n)
        sinceRestart = restartInterval
        continue
      }
      sinceRestart++
    }
    return bits.alignToMarker()
  }

  if (progressive) {
    for (const c of comps) {
      const q = qt[c.tq]
      if (!q) throw new UserError(DAMAGED)
      for (let row = 0; row < c.bhPad; row++) for (let col = 0; col < c.bwPad; col++) idct(c.coefs!, (row * c.bwPad + col) * 64, q, c.plane, row * 8 * c.bwPad * 8 + col * 8, c.bwPad * 8)
      c.coefs = null
    }
  }
  return { ...toRgba(comps, width, height, hmax, vmax, adobe, jfif), orientation, components: comps.length }
}

// ---------- upsampling and colour ----------

/** one component at full size: libjpeg's "fancy" (triangle) filter for the usual 2:1 cases, plain repetition otherwise */
function upsample(c: Comp, width: number, height: number, hmax: number, vmax: number): Uint8Array {
  const stride = c.bwPad * 8
  const cw = Math.ceil((width * c.h) / hmax)
  const ch = Math.ceil((height * c.v) / vmax)
  const hs = hmax / c.h
  const vs = vmax / c.v
  const out = new Uint8Array(width * height)
  const src = c.plane
  if (hs === 1 && vs === 1) {
    for (let y = 0; y < height; y++) out.set(src.subarray(y * stride, y * stride + width), y * width)
  } else if (hs === 2 && vs === 1) {
    for (let y = 0; y < height; y++) {
      const r = y * stride
      for (let x = 0; x < width; x++) {
        const i = x >> 1
        const near = src[r + i]
        out[y * width + x] = cw === 1 ? near : x & 1 ? (i + 1 < cw ? (3 * near + src[r + i + 1] + 2) >> 2 : near) : i > 0 ? (3 * near + src[r + i - 1] + 1) >> 2 : near
      }
    }
  } else if (hs === 2 && vs === 2) {
    const sums = new Int32Array(cw)
    for (let y = 0; y < height; y++) {
      const i = y >> 1
      // the row above for an upper output row, the one below for a lower one; rows beyond the picture repeat the edge
      const far = Math.min(ch - 1, Math.max(0, y & 1 ? i + 1 : i - 1))
      for (let x = 0; x < cw; x++) sums[x] = 3 * src[i * stride + x] + src[far * stride + x]
      for (let x = 0; x < width; x++) {
        const j = x >> 1
        const near = sums[j]
        let v: number
        if (cw === 1) v = (near * 4 + 8) >> 4
        else if (x & 1) v = j + 1 < cw ? (3 * near + sums[j + 1] + 7) >> 4 : (near * 4 + 7) >> 4
        else v = j > 0 ? (3 * near + sums[j - 1] + 8) >> 4 : (near * 4 + 8) >> 4
        out[y * width + x] = v
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const r = Math.min(ch - 1, Math.floor(y / vs)) * stride
      for (let x = 0; x < width; x++) out[y * width + x] = src[r + Math.min(cw - 1, Math.floor(x / hs))]
    }
  }
  return out
}

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

function toRgba(comps: Comp[], width: number, height: number, hmax: number, vmax: number, adobe: number, jfif: boolean): ImageBuffer {
  const out = createImage(width, height)
  const px = out.data
  const n = width * height
  const p = comps.map((c) => upsample(c, width, height, hmax, vmax))
  if (comps.length === 1 || comps.length === 2) {
    for (let i = 0; i < n; i++) {
      px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = p[0][i]
      px[i * 4 + 3] = 255
    }
    return out
  }
  // three components are YCbCr unless the file says otherwise (Adobe transform 0, or components named R, G, B)
  const rgbNamed = comps[0].id === 0x52 && comps[1].id === 0x47 && comps[2].id === 0x42
  const ycc = comps.length === 3 ? (adobe >= 0 ? adobe !== 0 : jfif || !rgbNamed) : adobe === 2
  const [a, b, c] = p
  for (let i = 0; i < n; i++) {
    let x = a[i]
    let y = b[i]
    let z = c[i]
    if (ycc) {
      const cb = y - 128
      const cr = z - 128
      x = clamp8(a[i] + 1.402 * cr)
      y = clamp8(a[i] - 0.344136 * cb - 0.714136 * cr)
      z = clamp8(a[i] + 1.772 * cb)
    }
    if (comps.length === 3) {
      px[i * 4] = x
      px[i * 4 + 1] = y
      px[i * 4 + 2] = z
    } else {
      // four components, as libjpeg gives them: YCCK becomes CMYK by inverting the colour part. Adobe files store
      // inverted CMYK (255 = no ink), other files plain CMYK.
      const k = p[3][i]
      const [cc, mm, yy] = ycc ? [255 - x, 255 - y, 255 - z] : [x, y, z]
      const ink = adobe >= 0
      px[i * 4] = Math.round(ink ? (cc * k) / 255 : ((255 - cc) * (255 - k)) / 255)
      px[i * 4 + 1] = Math.round(ink ? (mm * k) / 255 : ((255 - mm) * (255 - k)) / 255)
      px[i * 4 + 2] = Math.round(ink ? (yy * k) / 255 : ((255 - yy) * (255 - k)) / 255)
    }
    px[i * 4 + 3] = 255
  }
  return out
}
