// CFF font programs (Adobe TN 5176) with Type 2 charstrings (TN 5177): bare (FontFile3 /Type1C, /CIDFontType0C) or the
// `CFF ` table of an OpenType font. Name-keyed and CID-keyed (FDArray/FDSelect) fonts.
import { standard } from '../encodings.ts'
import { mul, type Matrix } from '../matrix.ts'
import { STANDARD_STRINGS } from './cff-strings.ts'
import { cached, transformed, unicodeIndex, type FontProgram, type GlyphPath } from './path.ts'

/** limits for hostile fonts */
const MAX_SUBR_DEPTH = 10
const MAX_OPS = 20000
const MAX_STACK = 513

type Index = Uint8Array[]

function readIndex(b: Uint8Array, at: number): { items: Index; end: number } {
  if (at + 2 > b.length) throw new RangeError('INDEX past the end')
  const count = (b[at] << 8) | b[at + 1]
  if (count === 0) return { items: [], end: at + 2 }
  const size = b[at + 2]
  if (size < 1 || size > 4) throw new RangeError('bad INDEX offset size')
  const offs = at + 3
  const off = (i: number) => {
    let v = 0
    for (let k = 0; k < size; k++) v = v * 256 + b[offs + i * size + k]
    return v
  }
  const data = offs + (count + 1) * size - 1
  const end = data + off(count)
  if (end > b.length) throw new RangeError('INDEX past the end')
  const items: Index = []
  for (let i = 0; i < count; i++) items.push(b.subarray(data + off(i), data + off(i + 1)))
  return { items, end }
}

type Dict = Map<number, number[]>

/** DICT data: operands then an operator; two-byte operators are 1200 + the second byte */
function readDict(b: Uint8Array): Dict {
  const out: Dict = new Map()
  let ops: number[] = []
  for (let i = 0; i < b.length; ) {
    const v = b[i]
    if (v <= 21) {
      const key = v === 12 ? 1200 + b[i + 1] : v
      i += v === 12 ? 2 : 1
      out.set(key, ops)
      ops = []
    } else if (v === 28) { ops.push(((b[i + 1] << 24) >> 16) | b[i + 2]); i += 3 }
    else if (v === 29) { ops.push((b[i + 1] << 24) | (b[i + 2] << 16) | (b[i + 3] << 8) | b[i + 4]); i += 5 }
    else if (v === 30) {
      let s = ''
      i++
      const nib = '0123456789.EE?-'
      for (;;) {
        const byte = b[i++]
        if (byte === undefined) break
        const hi = byte >> 4
        const lo = byte & 15
        if (hi === 15) break
        s += hi === 12 ? 'E-' : nib[hi]
        if (lo === 15) break
        s += lo === 12 ? 'E-' : nib[lo]
      }
      ops.push(parseFloat(s) || 0)
    } else if (v >= 32 && v <= 246) { ops.push(v - 139); i++ }
    else if (v >= 247 && v <= 250) { ops.push((v - 247) * 256 + b[i + 1] + 108); i += 2 }
    else if (v >= 251 && v <= 254) { ops.push(-(v - 251) * 256 - b[i + 1] - 108); i += 2 }
    else i++
  }
  return out
}

const bias = (subrs: Index) => (subrs.length < 1240 ? 107 : subrs.length < 33900 ? 1131 : 32768)

type Private = { subrs: Index }

function readPrivate(b: Uint8Array, entry: number[] | undefined): Private {
  if (!entry || entry.length < 2) return { subrs: [] }
  const [size, at] = entry
  const p = readDict(b.subarray(at, at + size))
  const subrsAt = p.get(19)?.[0]
  return { subrs: subrsAt === undefined ? [] : readIndex(b, at + subrsAt).items }
}

/** glyph -> string ID (or CID) for each glyph */
function readCharset(b: Uint8Array, at: number | undefined, n: number): number[] {
  const out = [0]
  if (at === undefined || at === 0) {
    // ISOAdobe: glyph i is string i. ponytail: the Expert charsets (1, 2) are read as ISOAdobe; no PDF in the wild needed them yet
    for (let i = 1; i < n; i++) out.push(i)
    return out
  }
  if (at <= 2) {
    for (let i = 1; i < n; i++) out.push(i)
    return out
  }
  const format = b[at]
  let p = at + 1
  if (format === 0) {
    while (out.length < n && p + 2 <= b.length) { out.push((b[p] << 8) | b[p + 1]); p += 2 }
  } else {
    while (out.length < n && p + 3 <= b.length) {
      const first = (b[p] << 8) | b[p + 1]
      const left = format === 1 ? b[p + 2] : (b[p + 2] << 8) | b[p + 3]
      p += format === 1 ? 3 : 4
      for (let k = 0; k <= left && out.length < n; k++) out.push(first + k)
    }
  }
  return out
}

export type CffProgram = FontProgram & { cid: boolean; byCid(cid: number): number | undefined }

export function readCff(b: Uint8Array): CffProgram {
  const header = b[2]
  const names = readIndex(b, header)
  const tops = readIndex(b, names.end)
  const strings = readIndex(b, tops.end)
  const gsubrs = readIndex(b, strings.end).items
  const top = readDict(tops.items[0] ?? new Uint8Array())
  const charStringsAt = top.get(17)?.[0]
  if (charStringsAt === undefined) throw new Error('CFF font without charstrings')
  const charStrings = readIndex(b, charStringsAt).items
  const n = charStrings.length
  const fm = top.get(1207)
  const matrix: Matrix = fm && fm.length === 6 ? (fm as Matrix) : [0.001, 0, 0, 0.001, 0, 0]
  const cid = top.has(1230)
  const charset = readCharset(b, top.get(15)?.[0], n)
  const latin1 = (u: Uint8Array) => Array.from(u, (c) => String.fromCharCode(c)).join('')
  const sid = (s: number) => (s < STANDARD_STRINGS.length ? STANDARD_STRINGS[s] : latin1(strings.items[s - STANDARD_STRINGS.length] ?? new Uint8Array()))

  // the Private DICT (local subrs) of each glyph: one for a name-keyed font, one per FD for a CID-keyed one
  let privateOf: (gid: number) => Private
  /** a CID-keyed font's glyphs go straight to text space: each font dict may have its own matrix (times the top one) */
  let matrixOf: ((gid: number) => Matrix) | null = null
  if (cid) {
    const fds = readIndex(b, top.get(1236)?.[0] ?? 0).items.map(readDict)
    const privates = fds.map((d) => readPrivate(b, d.get(18)))
    const matrices = fds.map((d): Matrix => {
      const own = d.get(1207)
      const m = own && own.length === 6 ? (own as Matrix) : null
      return m && fm && fm.length === 6 ? mul(m, fm as Matrix) : (m ?? matrix)
    })
    const select = readFdSelect(b, top.get(1237)?.[0], n)
    privateOf = (gid) => privates[select(gid)] ?? { subrs: [] }
    matrixOf = (gid) => matrices[select(gid)] ?? matrix
  } else {
    const p = readPrivate(b, top.get(18))
    privateOf = () => p
  }

  const nameToGid = new Map<string, number>()
  const cidToGid = new Map<number, number>()
  charset.forEach((s, gid) => (cid ? cidToGid.set(s, gid) : nameToGid.set(sid(s), gid)))
  const byUni = cid ? new Map<string, number>() : unicodeIndex(nameToGid)
  const builtin = cid ? null : readEncoding(b, top.get(16)?.[0], charset, byUni)

  const glyph = cached((gid) => {
    if (gid < 0 || gid >= n) return null
    const path = charstring(charStrings[gid], gsubrs, privateOf(gid).subrs, (code) => {
      // seac-style accents in endchar: StandardEncoding codes
      const u = standard[code]
      const g = u ? byUni.get(u) : undefined
      return g === undefined ? null : (charstring(charStrings[g], gsubrs, privateOf(g).subrs, () => null))
    })
    return matrixOf ? transformed(path, matrixOf(gid)) : path
  })

  return {
    matrix: matrixOf ? [1, 0, 0, 1, 0, 0] : matrix,
    cid,
    glyph,
    byName: (name) => nameToGid.get(name),
    byUnicode: (text) => byUni.get(text),
    byCid: (c) => (cid ? cidToGid.get(c) : c < n ? c : undefined),
    builtin: builtin ? (code) => builtin.get(code) : undefined,
  }
}

function readFdSelect(b: Uint8Array, at: number | undefined, n: number): (gid: number) => number {
  if (at === undefined) return () => 0
  const format = b[at]
  if (format === 0) return (gid) => b[at + 1 + gid] ?? 0
  if (format === 3) {
    const count = (b[at + 1] << 8) | b[at + 2]
    const ranges: [number, number][] = []
    for (let i = 0; i < count; i++) ranges.push([(b[at + 3 + i * 3] << 8) | b[at + 4 + i * 3], b[at + 5 + i * 3]])
    return (gid) => {
      let fd = 0
      for (const [first, d] of ranges) {
        if (first > gid) break
        fd = d
      }
      return gid < n ? fd : 0
    }
  }
  return () => 0
}

/** a name-keyed font's own code -> glyph table: Standard (0), Expert (1, read as Standard) or one of its own */
function readEncoding(b: Uint8Array, at: number | undefined, charset: number[], byUni: Map<string, number>): Map<number, number> {
  const out = new Map<number, number>()
  if (at === undefined || at <= 1) {
    standard.forEach((u, code) => {
      const g = u ? byUni.get(u) : undefined
      if (g !== undefined) out.set(code, g)
    })
    return out
  }
  const format = b[at] & 0x7f
  let p = at + 1
  if (format === 0) {
    const count = b[p++]
    for (let gid = 1; gid <= count; gid++) out.set(b[p++], gid)
  } else if (format === 1) {
    const ranges = b[p++]
    let gid = 1
    for (let r = 0; r < ranges; r++) {
      const first = b[p++]
      const left = b[p++]
      for (let k = 0; k <= left; k++) out.set(first + k, gid++)
    }
  }
  if (b[at] & 0x80) {
    // supplements: more codes for glyphs already named, by string ID
    const sups = b[p++]
    for (let s = 0; s < sups; s++) {
      const code = b[p]
      const id = (b[p + 1] << 8) | b[p + 2]
      p += 3
      const gid = charset.indexOf(id)
      if (gid > 0) out.set(code, gid)
    }
  }
  return out
}

/** run a Type 2 charstring into a path; `accent` draws a StandardEncoding glyph for endchar's seac form */
function charstring(code: Uint8Array, gsubrs: Index, lsubrs: Index, accent: (code: number) => GlyphPath | null): GlyphPath {
  const path: GlyphPath = []
  const stack: number[] = []
  let x = 0
  let y = 0
  let stems = 0
  let width = false // the optional advance width, before the first stack-clearing operator, has been taken
  let open = false
  let ops = 0
  const gbias = bias(gsubrs)
  const lbias = bias(lsubrs)
  const transient: number[] = []

  const moveTo = (dx: number, dy: number) => {
    if (open) path.push(['Z'])
    x += dx
    y += dy
    path.push(['M', x, y])
    open = true
  }
  const lineTo = (dx: number, dy: number) => {
    x += dx
    y += dy
    path.push(['L', x, y])
  }
  const curveTo = (a: number, b: number, c: number, d: number, e: number, f: number) => {
    const x1 = x + a, y1 = y + b, x2 = x1 + c, y2 = y1 + d
    x = x2 + e
    y = y2 + f
    path.push(['C', x1, y1, x2, y2, x, y])
  }
  /** the width is the first operand when there is one more than the operator takes */
  const takeWidth = (even: boolean) => {
    if (!width && stack.length % 2 === (even ? 1 : 0)) stack.shift()
    width = true
  }
  const stem = () => {
    takeWidth(true)
    stems += stack.length >> 1
    stack.length = 0
  }

  const run = (s: Uint8Array, depth: number): boolean => {
    if (depth > MAX_SUBR_DEPTH) throw new RangeError('subroutines nested too deeply')
    for (let i = 0; i < s.length; ) {
      if (++ops > MAX_OPS) throw new RangeError('charstring too long')
      if (stack.length > MAX_STACK) throw new RangeError('charstring stack overflow')
      const v = s[i]
      if (v >= 32) {
        if (v <= 246) { stack.push(v - 139); i++ }
        else if (v <= 250) { stack.push((v - 247) * 256 + s[i + 1] + 108); i += 2 }
        else if (v <= 254) { stack.push(-(v - 251) * 256 - s[i + 1] - 108); i += 2 }
        else { stack.push(((s[i + 1] << 24) | (s[i + 2] << 16) | (s[i + 3] << 8) | s[i + 4]) / 65536); i += 5 }
        continue
      }
      if (v === 28) { stack.push(((s[i + 1] << 24) >> 16) | s[i + 2]); i += 3; continue }
      i++
      switch (v) {
        case 1: case 3: case 18: case 23: stem(); break
        case 19: case 20: // hintmask, cntrmask: pending operands are vstems
          stem()
          i += (stems + 7) >> 3
          break
        case 21: takeWidth(true); moveTo(stack[0] ?? 0, stack[1] ?? 0); stack.length = 0; break
        case 22: takeWidth(false); moveTo(stack[0] ?? 0, 0); stack.length = 0; break
        case 4: takeWidth(false); moveTo(0, stack[0] ?? 0); stack.length = 0; break
        case 5: for (let k = 0; k + 1 < stack.length; k += 2) lineTo(stack[k], stack[k + 1]); stack.length = 0; break
        case 6: case 7: {
          let horizontal = v === 6
          for (const d of stack) {
            if (horizontal) lineTo(d, 0)
            else lineTo(0, d)
            horizontal = !horizontal
          }
          stack.length = 0
          break
        }
        case 8: for (let k = 0; k + 5 < stack.length; k += 6) curveTo(stack[k], stack[k + 1], stack[k + 2], stack[k + 3], stack[k + 4], stack[k + 5]); stack.length = 0; break
        case 24: { // rcurveline
          let k = 0
          for (; k + 7 < stack.length; k += 6) curveTo(stack[k], stack[k + 1], stack[k + 2], stack[k + 3], stack[k + 4], stack[k + 5])
          lineTo(stack[k] ?? 0, stack[k + 1] ?? 0)
          stack.length = 0
          break
        }
        case 25: { // rlinecurve
          let k = 0
          for (; k + 7 < stack.length; k += 2) lineTo(stack[k], stack[k + 1])
          curveTo(stack[k] ?? 0, stack[k + 1] ?? 0, stack[k + 2] ?? 0, stack[k + 3] ?? 0, stack[k + 4] ?? 0, stack[k + 5] ?? 0)
          stack.length = 0
          break
        }
        case 26: { // vvcurveto
          let k = 0
          let dx1 = 0
          if (stack.length % 4 === 1) dx1 = stack[k++]
          for (; k + 3 < stack.length; k += 4) {
            curveTo(dx1, stack[k], stack[k + 1], stack[k + 2], 0, stack[k + 3])
            dx1 = 0
          }
          stack.length = 0
          break
        }
        case 27: { // hhcurveto
          let k = 0
          let dy1 = 0
          if (stack.length % 4 === 1) dy1 = stack[k++]
          for (; k + 3 < stack.length; k += 4) {
            curveTo(stack[k], dy1, stack[k + 1], stack[k + 2], stack[k + 3], 0)
            dy1 = 0
          }
          stack.length = 0
          break
        }
        case 30: case 31: { // vhcurveto, hvcurveto: alternating start tangents, an optional last delta
          let horizontal = v === 31
          for (let k = 0; k + 3 < stack.length; k += 4) {
            const last = k + 5 === stack.length ? stack[k + 4] : 0
            if (horizontal) curveTo(stack[k], 0, stack[k + 1], stack[k + 2], last, stack[k + 3])
            else curveTo(0, stack[k], stack[k + 1], stack[k + 2], stack[k + 3], last)
            horizontal = !horizontal
          }
          stack.length = 0
          break
        }
        case 10: case 29: { // callsubr, callgsubr
          const subrs = v === 10 ? lsubrs : gsubrs
          const sub = subrs[(stack.pop() ?? 0) + (v === 10 ? lbias : gbias)]
          if (!sub) throw new RangeError('missing subroutine')
          if (run(sub, depth + 1)) return true
          break
        }
        case 11: return false // return
        case 14: { // endchar, or seac with four more operands
          if (!width && (stack.length === 1 || stack.length === 5)) stack.shift()
          width = true
          if (stack.length === 4) {
            const [adx, ady, bchar, achar] = stack
            const base = accent(bchar)
            const acc = accent(achar)
            if (base) path.push(...base)
            if (acc) path.push(...transformed(acc, [1, 0, 0, 1, adx, ady]))
          }
          if (open) path.push(['Z'])
          open = false
          return true
        }
        case 12: {
          const e = s[i++]
          const a = stack
          if (e === 35) { // flex
            curveTo(a[0], a[1], a[2], a[3], a[4], a[5])
            curveTo(a[6], a[7], a[8], a[9], a[10], a[11])
          } else if (e === 34) { // hflex
            const y0 = y
            curveTo(a[0], 0, a[1], a[2], a[3], 0)
            curveTo(a[4], 0, a[5], y0 - y, a[6], 0)
          } else if (e === 36) { // hflex1
            const y0 = y
            curveTo(a[0], a[1], a[2], a[3], a[4], 0)
            curveTo(a[5], 0, a[6], a[7], a[8], y0 - y - a[7])
          } else if (e === 37) { // flex1: the last point returns to the start on the axis that moved less
            const dx = a[0] + a[2] + a[4] + a[6] + a[8]
            const dy = a[1] + a[3] + a[5] + a[7] + a[9]
            curveTo(a[0], a[1], a[2], a[3], a[4], a[5])
            if (Math.abs(dx) > Math.abs(dy)) curveTo(a[6], a[7], a[8], a[9], a[10], -dy)
            else curveTo(a[6], a[7], a[8], a[9], -dx, a[10])
          } else {
            // arithmetic and storage: the few that fonts use
            const b1 = a.pop() ?? 0
            if (e === 9) a.push(Math.abs(b1))
            else if (e === 14) a.push(-b1)
            else if (e === 18) { /* drop */ }
            else if (e === 27) a.push(b1, b1)
            else if (e === 28) { const b0 = a.pop() ?? 0; a.push(b1, b0) }
            else if (e === 20) transient[b1] = a.pop() ?? 0 // val i put
            else if (e === 21) a.push(transient[b1] ?? 0)
            else {
              const b0 = a.pop() ?? 0
              if (e === 10) a.push(b0 + b1)
              else if (e === 11) a.push(b0 - b1)
              else if (e === 12) a.push(b1 ? b0 / b1 : 0)
              else if (e === 24) a.push(b0 * b1)
              else if (e === 3) a.push(b0 && b1 ? 1 : 0)
              else if (e === 4) a.push(b0 || b1 ? 1 : 0)
              else if (e === 15) a.push(b0 === b1 ? 1 : 0)
              else a.push(0)
            }
            break
          }
          stack.length = 0
          break
        }
        default: stack.length = 0
      }
    }
    return false
  }
  run(code, 0)
  if (open) path.push(['Z'])
  return path
}
