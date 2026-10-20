// TrueType outlines (`glyf`) as PDFs embed them: often cut down to a few glyphs and missing tables a font file on disk
// would have (hhea, hmtx, even cmap), so only head, loca and glyf are required.
import { readTables } from '@ream/pdf-core'
import { cached, transformed, type FontProgram, type GlyphPath } from './path.ts'

const MAX_DEPTH = 8

export type TrueTypeProgram = FontProgram & {
  /** the cmap subtable for one platform and encoding, as code -> glyph, if the font has it */
  cmap(platform: number, encoding: number): ((code: number) => number) | null
  numGlyphs: number
  /** advance width in thousandths of the em, from hmtx; undefined when the font has none */
  advance(gid: number): number | undefined
}

export function readTrueType(bytes: Uint8Array): TrueTypeProgram {
  const tables = readTables(bytes)
  const [head, loca, glyfTable] = [tables.get('head'), tables.get('loca'), tables.get('glyf')]
  if (!head || !loca || !glyfTable) throw new Error('not a TrueType font program')
  const glyf = glyfTable
  const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)
  const hv = dv(head)
  const upem = hv.getUint16(18) || 1000
  const long = hv.getInt16(50) === 1
  const lv = dv(loca)
  const numGlyphs = Math.max(0, (long ? loca.length / 4 : loca.length / 2) - 1) | 0
  const offset = (gid: number) => (long ? lv.getUint32(gid * 4) : lv.getUint16(gid * 2) * 2)
  const gv = dv(glyf)

  const read = (gid: number, depth: number): GlyphPath | null => {
    if (gid < 0 || gid >= numGlyphs || depth > MAX_DEPTH) return null
    const start = offset(gid)
    const end = offset(gid + 1)
    if (end <= start) return [] // an empty glyph (a space)
    if (end > glyf.length) return null
    const contours = gv.getInt16(start)
    return contours >= 0 ? simple(start, contours) : composite(start + 10, end, depth)
  }

  function simple(at: number, contours: number): GlyphPath {
    const ends: number[] = []
    for (let i = 0; i < contours; i++) ends.push(gv.getUint16(at + 10 + i * 2))
    const n = contours ? ends[contours - 1] + 1 : 0
    let p = at + 10 + contours * 2
    p += 2 + gv.getUint16(p) // instructions
    const flags: number[] = []
    while (flags.length < n) {
      const f = glyf[p++]
      flags.push(f)
      if (f & 8) for (let r = glyf[p++]; r > 0 && flags.length < n; r--) flags.push(f)
    }
    const coords = (short: number, same: number) => {
      const out: number[] = []
      let v = 0
      for (const f of flags) {
        if (f & short) v += f & same ? glyf[p++] : -glyf[p++]
        else if (!(f & same)) { v += gv.getInt16(p); p += 2 }
        out.push(v)
      }
      return out
    }
    const xs = coords(2, 16)
    const ys = coords(4, 32)
    if (p > glyf.length) throw new RangeError('glyph runs past its table')
    const path: GlyphPath = []
    let from = 0
    for (const last of ends) {
      contour(path, xs.slice(from, last + 1), ys.slice(from, last + 1), flags.slice(from, last + 1).map((f) => (f & 1) === 1))
      from = last + 1
    }
    return path
  }

  function composite(at: number, end: number, depth: number): GlyphPath | null {
    const path: GlyphPath = []
    for (;;) {
      if (at + 4 > end) return path
      const flags = gv.getUint16(at)
      const part = gv.getUint16(at + 2)
      at += 4
      let dx: number, dy: number
      if (flags & 1) { dx = gv.getInt16(at); dy = gv.getInt16(at + 2); at += 4 }
      else { dx = gv.getInt8(at); dy = gv.getInt8(at + 1); at += 2 }
      // ponytail: components placed by matching points (ARGS_ARE_XY_VALUES unset) are put at 0,0; rare in practice
      if (!(flags & 2)) dx = dy = 0
      let [a, b, c, d] = [1, 0, 0, 1]
      const f2 = (o: number) => gv.getInt16(o) / 16384
      if (flags & 8) { a = d = f2(at); at += 2 }
      else if (flags & 0x40) { a = f2(at); d = f2(at + 2); at += 4 }
      else if (flags & 0x80) { a = f2(at); b = f2(at + 2); c = f2(at + 4); d = f2(at + 6); at += 8 }
      const sub = read(part, depth + 1)
      if (sub) path.push(...transformed(sub, [a, b, c, d, dx, dy]))
      if (!(flags & 0x20)) return path
    }
  }

  const hhea = tables.get('hhea')
  const hmtx = tables.get('hmtx')
  const metrics = hhea && hhea.length >= 36 ? dv(hhea).getUint16(34) : 0
  const advance = (gid: number) => {
    if (!hmtx || !metrics) return undefined
    const at = Math.min(gid, metrics - 1) * 4
    return at + 2 <= hmtx.length ? (dv(hmtx).getUint16(at) / upem) * 1000 : undefined
  }
  const cmaps = readCmaps(tables.get('cmap'))
  const unicode = cmaps(3, 1) ?? cmaps(0, 3) ?? cmaps(3, 10) ?? cmaps(0, 4)
  return {
    matrix: [1 / upem, 0, 0, 1 / upem, 0, 0],
    numGlyphs,
    advance,
    glyph: cached((gid) => read(gid, 0)),
    cmap: cmaps,
    byName: () => undefined,
    byUnicode: (text) => {
      const cp = text.codePointAt(0)
      const g = cp === undefined || !unicode ? 0 : unicode(cp)
      return g || undefined
    },
  }
}

/** one closed contour of on- and off-curve points; two off-curve points in a row imply an on-curve point between them */
function contour(path: GlyphPath, xs: number[], ys: number[], on: boolean[]) {
  const n = xs.length
  if (!n) return
  type P = { x: number; y: number; on: boolean }
  const pts: P[] = xs.map((x, i) => ({ x, y: ys[i], on: on[i] }))
  const mid = (p: P, q: P): P => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, on: true })
  // start on an on-curve point; a contour of only control points starts between its last and first
  const first = pts.findIndex((p) => p.on)
  const seq = first >= 0 ? [...pts.slice(first), ...pts.slice(0, first)] : [mid(pts[n - 1], pts[0]), ...pts]
  path.push(['M', seq[0].x, seq[0].y])
  let ctrl: P | null = null
  for (let i = 1; i <= seq.length; i++) {
    const p = seq[i % seq.length]
    if (p.on) {
      path.push(ctrl ? ['Q', ctrl.x, ctrl.y, p.x, p.y] : ['L', p.x, p.y])
      ctrl = null
    } else {
      if (ctrl) {
        const m = mid(ctrl, p)
        path.push(['Q', ctrl.x, ctrl.y, m.x, m.y])
      }
      ctrl = p
    }
  }
  path.push(['Z'])
}

/** the cmap subtables a font has, by platform and encoding (formats 0, 4, 6 and 12) */
function readCmaps(t: Uint8Array | undefined): (platform: number, encoding: number) => ((code: number) => number) | null {
  if (!t || t.length < 4) return () => null
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength)
  const found = new Map<string, (code: number) => number>()
  for (let i = 0; i < v.getUint16(2) && 8 + i * 8 <= t.length; i++) {
    const key = `${v.getUint16(4 + i * 8)}/${v.getUint16(6 + i * 8)}`
    const o = v.getUint32(8 + i * 8)
    if (found.has(key) || o + 6 > t.length) continue
    const map = subtable(t, v, o)
    if (map) found.set(key, map)
  }
  return (p, e) => found.get(`${p}/${e}`) ?? null
}

function subtable(t: Uint8Array, v: DataView, o: number): ((code: number) => number) | null {
  const format = v.getUint16(o)
  const safe = (f: (c: number) => number) => (c: number) => {
    try {
      return f(c)
    } catch {
      return 0
    }
  }
  if (format === 0) return (c) => (c >= 0 && c < 256 && o + 6 + c < t.length ? t[o + 6 + c] : 0)
  if (format === 6) {
    const first = v.getUint16(o + 6)
    const count = v.getUint16(o + 8)
    return safe((c) => (c >= first && c < first + count ? v.getUint16(o + 10 + (c - first) * 2) : 0))
  }
  if (format === 4) {
    const segs = v.getUint16(o + 6) / 2
    const ends = o + 14
    const starts = ends + segs * 2 + 2
    const deltas = starts + segs * 2
    const ranges = deltas + segs * 2
    return safe((c) => {
      if (c > 0xffff) return 0
      for (let i = 0; i < segs; i++) {
        if (c > v.getUint16(ends + i * 2)) continue
        if (c < v.getUint16(starts + i * 2)) return 0
        const range = v.getUint16(ranges + i * 2)
        if (range === 0) return (c + v.getUint16(deltas + i * 2)) & 0xffff
        const g = v.getUint16(ranges + i * 2 + range + (c - v.getUint16(starts + i * 2)) * 2)
        return g === 0 ? 0 : (g + v.getUint16(deltas + i * 2)) & 0xffff
      }
      return 0
    })
  }
  if (format === 12) {
    const groups = v.getUint32(o + 12)
    return safe((c) => {
      let [lo, hi] = [0, groups - 1]
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const [start, end, first] = [v.getUint32(o + 16 + mid * 12), v.getUint32(o + 20 + mid * 12), v.getUint32(o + 24 + mid * 12)]
        if (c < start) hi = mid - 1
        else if (c > end) lo = mid + 1
        else return first + c - start
      }
      return 0
    })
  }
  return null
}
