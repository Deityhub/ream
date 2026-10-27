// Type 1 font programs (FontFile): a cleartext part (FontMatrix, Encoding), then an eexec-encrypted part with the
// subroutines and the encrypted charstrings (Adobe Type 1 Font Format).
import { standard } from '../encodings.ts'
import type { Matrix } from '../matrix.ts'
import { cached, transformed, unicodeIndex, type FontProgram, type GlyphPath } from './path.ts'

const MAX_SUBR_DEPTH = 10
const MAX_OPS = 20000

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('')

function decrypt(data: Uint8Array, key: number, skip: number): Uint8Array {
  let r = key
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const c = data[i]
    out[i] = c ^ (r >> 8)
    r = ((c + r) * 52845 + 22719) & 0xffff
  }
  return out.subarray(Math.max(0, skip))
}

const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)

/** a .pfb's segments (0x80 0x01/0x02 headers) joined, or the bytes as they are */
function unwrapPfb(b: Uint8Array): Uint8Array {
  if (b[0] !== 0x80) return b
  const parts: Uint8Array[] = []
  for (let at = 0; at + 6 <= b.length && b[at] === 0x80 && b[at + 1] !== 3; ) {
    const len = b[at + 2] | (b[at + 3] << 8) | (b[at + 4] << 16) | (b[at + 5] << 24)
    parts.push(b.subarray(at + 6, at + 6 + len))
    at += 6 + len
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}

/**
 * `length1` is the cleartext part's length from the stream dictionary; when it is missing or wrong, the start of the
 * encrypted part is found after "eexec".
 */
export function readType1(raw: Uint8Array, length1?: number): FontProgram {
  const b = unwrapPfb(raw)
  const head = latin1(b.subarray(0, Math.min(b.length, 65536)))
  const eexec = head.indexOf('eexec')
  if (eexec < 0) throw new Error('no eexec section')
  // the cleartext part ends a line or so after "eexec": Length1 says exactly where; without it, skip the line break
  let start = eexec + 5
  if (length1 !== undefined && length1 >= start && length1 <= start + 4) start = length1
  else while (start < eexec + 9 && (b[start] === 13 || b[start] === 10 || b[start] === 32 || b[start] === 9)) start++
  const clear = head.slice(0, start)

  const fm = /\/FontMatrix\s*\[([^\]]*)\]/.exec(clear)
  const nums = fm ? fm[1].trim().split(/\s+/).map(Number) : []
  const matrix: Matrix = nums.length === 6 && nums.every(Number.isFinite) ? (nums as Matrix) : [0.001, 0, 0, 0.001, 0, 0]

  // the built-in encoding: StandardEncoding, or "dup <code> /<name> put" lines
  const encodingNames = new Map<number, string>()
  const standardEncoding = /\/Encoding\s+StandardEncoding/.test(clear)
  for (const m of clear.matchAll(/dup\s+(\d+)\s*\/([^\s/[\]{}()<>]+)\s+put/g)) encodingNames.set(Number(m[1]), m[2])

  // the encrypted part, binary or hex
  let enc = b.subarray(start)
  if (enc.length >= 4 && [0, 1, 2, 3].every((k) => isHex(enc[k]))) {
    const hex = latin1(enc).replace(/[^0-9a-fA-F]/g, '')
    enc = Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16))
  }
  const priv = decrypt(enc, 55665, 4)
  const text = latin1(priv)
  const lenIVm = /\/lenIV\s+(-?\d+)/.exec(text)
  const lenIV = lenIVm ? Number(lenIVm[1]) : 4
  const strings = (data: Uint8Array) => (lenIV < 0 ? data : decrypt(data, 4330, lenIV))

  // "dup i n RD <n bytes> NP" for subroutines, "/name n RD <n bytes> ND" for charstrings; RD may be spelled -|
  const subrs: Uint8Array[] = []
  const subrsAt = text.indexOf('/Subrs')
  const charsAt = text.indexOf('/CharStrings')
  if (subrsAt >= 0) {
    const re = /dup\s+(\d+)\s+(\d+)\s+(\S+)\s/y
    const scan = /dup\s+\d+\s+\d+\s+\S+\s/g
    scan.lastIndex = subrsAt
    for (let m = scan.exec(text); m && (charsAt < 0 || m.index < charsAt); m = scan.exec(text)) {
      re.lastIndex = m.index
      const r = re.exec(text)
      if (!r) break
      const at = m.index + r[0].length
      const len = Number(r[2])
      subrs[Number(r[1])] = strings(priv.subarray(at, at + len))
      scan.lastIndex = at + len
    }
  }
  const glyphs: Uint8Array[] = []
  const names = new Map<string, number>()
  if (charsAt >= 0) {
    const scan = /\/([^\s/[\]{}()<>]+)\s+(\d+)\s+(\S+)\s/g
    scan.lastIndex = charsAt + 12
    for (let m = scan.exec(text); m; m = scan.exec(text)) {
      const at = m.index + m[0].length
      const len = Number(m[2])
      if (m[3] !== 'RD' && m[3] !== '-|') continue
      if (!names.has(m[1])) names.set(m[1], glyphs.length)
      glyphs.push(strings(priv.subarray(at, at + len)))
      scan.lastIndex = at + len
    }
  }

  const byUni = unicodeIndex(names)
  const builtin = new Map<number, number>()
  if (standardEncoding) {
    standard.forEach((u, code) => {
      const g = u ? byUni.get(u) : undefined
      if (g !== undefined) builtin.set(code, g)
    })
  }
  for (const [code, name] of encodingNames) {
    const g = names.get(name)
    if (g !== undefined) builtin.set(code, g)
  }
  const standardGlyph = (code: number) => {
    const u = standard[code]
    return u ? byUni.get(u) : undefined
  }

  const glyph = cached((gid) => (glyphs[gid] ? charstring(glyphs[gid], subrs, (code) => {
    const g = standardGlyph(code)
    return g === undefined || !glyphs[g] ? null : charstring(glyphs[g], subrs, () => null)
  }).path : null))

  return {
    matrix,
    glyph,
    byName: (name) => names.get(name),
    byUnicode: (t) => byUni.get(t),
    builtin: (code) => builtin.get(code),
  }
}

type Run = { path: GlyphPath; sbx: number }

/** a decrypted Type 1 charstring as a path; `accent` runs another glyph for seac */
function charstring(code: Uint8Array, subrs: Uint8Array[], accent: (code: number) => Run | null): Run {
  const path: GlyphPath = []
  const stack: number[] = []
  const ps: number[] = [] // results of othersubrs, read back by pop
  let x = 0
  let y = 0
  let sbx = 0
  let open = false
  let ops = 0
  let flex: [number, number][] | null = null

  const moveTo = (nx: number, ny: number) => {
    if (flex) {
      flex.push([nx, ny])
      x = nx
      y = ny
      return
    }
    if (open) path.push(['Z'])
    x = nx
    y = ny
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

  const run = (s: Uint8Array, depth: number): boolean => {
    if (depth > MAX_SUBR_DEPTH) throw new RangeError('subroutines nested too deeply')
    for (let i = 0; i < s.length; ) {
      if (++ops > MAX_OPS) throw new RangeError('charstring too long')
      const v = s[i]
      if (v >= 32) {
        if (v <= 246) { stack.push(v - 139); i++ }
        else if (v <= 250) { stack.push((v - 247) * 256 + s[i + 1] + 108); i += 2 }
        else if (v <= 254) { stack.push(-(v - 251) * 256 - s[i + 1] - 108); i += 2 }
        else { stack.push((s[i + 1] << 24) | (s[i + 2] << 16) | (s[i + 3] << 8) | s[i + 4]); i += 5 }
        continue
      }
      i++
      const a = stack
      switch (v) {
        case 13: sbx = a[0] ?? 0; x = sbx; y = 0; a.length = 0; break // hsbw
        case 21: moveTo(x + (a[0] ?? 0), y + (a[1] ?? 0)); a.length = 0; break
        case 22: moveTo(x + (a[0] ?? 0), y); a.length = 0; break
        case 4: moveTo(x, y + (a[0] ?? 0)); a.length = 0; break
        case 5: lineTo(a[0] ?? 0, a[1] ?? 0); a.length = 0; break
        case 6: lineTo(a[0] ?? 0, 0); a.length = 0; break
        case 7: lineTo(0, a[0] ?? 0); a.length = 0; break
        case 8: curveTo(a[0], a[1], a[2], a[3], a[4], a[5]); a.length = 0; break
        case 30: curveTo(0, a[0], a[1], a[2], a[3], 0); a.length = 0; break // vhcurveto
        case 31: curveTo(a[0], 0, a[1], a[2], 0, a[3]); a.length = 0; break // hvcurveto
        case 9: if (open) path.push(['Z']); open = false; a.length = 0; break // closepath
        case 10: { // callsubr
          const sub = subrs[a.pop() ?? -1]
          if (!sub) throw new RangeError('missing subroutine')
          if (run(sub, depth + 1)) return true
          break
        }
        case 11: return false
        case 14: if (open) path.push(['Z']); open = false; return true // endchar
        case 1: case 3: a.length = 0; break // hstem, vstem
        case 12: {
          const e = s[i++]
          if (e === 7) { sbx = a[0] ?? 0; x = sbx; y = a[1] ?? 0; a.length = 0 } // sbw
          else if (e === 6) { // seac: asb adx ady bchar achar
            const [asb, adx, ady, bchar, achar] = a
            a.length = 0
            const base = accent(bchar)
            const acc = accent(achar)
            if (base) path.push(...base.path)
            // as FreeType does: the accent is moved by adx, less its own side bearing, plus this glyph's
            if (acc) path.push(...transformed(acc.path, [1, 0, 0, 1, adx - asb + sbx, ady]))
            open = false
            return true
          } else if (e === 12) { const d = a.pop() ?? 1; const n = a.pop() ?? 0; a.push(d ? n / d : 0) } // div
          else if (e === 16) { // callothersubr: flex (0, 1, 2) and hint replacement (3)
            const other = a.pop() ?? -1
            const count = a.pop() ?? 0
            const args = a.splice(Math.max(0, a.length - count), count)
            if (other === 1) flex = []
            else if (other === 2) { /* the next rmoveto adds a flex point */ }
            else if (other === 0 && flex) {
              // the reference point, then six control and end points of two curves
              const f = flex
              flex = null
              if (f.length >= 7) {
                path.push(['C', f[1][0], f[1][1], f[2][0], f[2][1], f[3][0], f[3][1]])
                path.push(['C', f[4][0], f[4][1], f[5][0], f[5][1], f[6][0], f[6][1]])
                ;[x, y] = f[6]
              }
              ps.push(args[2] ?? y, args[1] ?? x)
            } else if (other === 3) ps.push(3)
            else ps.push(...args.reverse())
          } else if (e === 17) a.push(ps.pop() ?? 0) // pop
          else if (e === 33) { x = a[0] ?? x; y = a[1] ?? y; a.length = 0 } // setcurrentpoint
          else a.length = 0 // dotsection, vstem3, hstem3
          break
        }
        default: a.length = 0
      }
    }
    return false
  }
  run(code, 0)
  if (open) path.push(['Z'])
  return { path, sbx }
}
