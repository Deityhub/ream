// Glyph outlines as plain numbers, so the readers stay free of canvas types: one command letter, then its points.
import { glyphToUnicode } from '../encodings.ts'
import type { Matrix } from '../matrix.ts'

export type Cmd = ['M', number, number] | ['L', number, number] | ['Q', number, number, number, number] | ['C', number, number, number, number, number, number] | ['Z']
export type GlyphPath = Cmd[]

/** a font program read from a PDF: glyph shapes by glyph number, and the ways a PDF names a glyph */
export interface FontProgram {
  /** glyph space to text space (1/unitsPerEm, or a PostScript font's FontMatrix) */
  matrix: Matrix
  /** null when the glyph doesn't exist or can't be read */
  glyph(gid: number): GlyphPath | null
  /** by PostScript glyph name (Type 1, CFF, a TrueType `post` table if ever needed) */
  byName(name: string): number | undefined
  /** by Unicode text, through the glyph names (Type 1, CFF) or a Unicode cmap (TrueType) */
  byUnicode(text: string): number | undefined
  /** the font's own code -> glyph table (a Type 1 or CFF built-in encoding) */
  builtin?(code: number): number | undefined
}

/** Unicode -> glyph from glyph names: plain names win over variants ("a" over "a.sc") */
export function unicodeIndex(names: Iterable<[string, number]>): Map<string, number> {
  const out = new Map<string, number>()
  const plain = new Set<string>()
  for (const [name, gid] of names) {
    const u = glyphToUnicode(name)
    if (u === undefined) continue
    const isPlain = !name.includes('.')
    if (!out.has(u) || (isPlain && !plain.has(u))) {
      out.set(u, gid)
      if (isPlain) plain.add(u)
    }
  }
  return out
}

/** cache each glyph's path the first time it is asked for; any reader error is a missing glyph */
export function cached(read: (gid: number) => GlyphPath | null): (gid: number) => GlyphPath | null {
  const seen = new Map<number, GlyphPath | null>()
  return (gid) => {
    let p = seen.get(gid)
    if (p === undefined) {
      try {
        p = read(gid)
      } catch {
        p = null
      }
      seen.set(gid, p)
    }
    return p
  }
}

/** the path offset (and optionally scaled) by a 2x3 matrix: composite and accented glyphs */
export function transformed(path: GlyphPath, [a, b, c, d, e, f]: Matrix): GlyphPath {
  const x = (px: number, py: number) => a * px + c * py + e
  const y = (px: number, py: number) => b * px + d * py + f
  return path.map((cmd): Cmd => {
    switch (cmd[0]) {
      case 'M': case 'L': return [cmd[0], x(cmd[1], cmd[2]), y(cmd[1], cmd[2])]
      case 'Q': return ['Q', x(cmd[1], cmd[2]), y(cmd[1], cmd[2]), x(cmd[3], cmd[4]), y(cmd[3], cmd[4])]
      case 'C': return ['C', x(cmd[1], cmd[2]), y(cmd[1], cmd[2]), x(cmd[3], cmd[4]), y(cmd[3], cmd[4]), x(cmd[5], cmd[6]), y(cmd[5], cmd[6])]
      default: return cmd
    }
  })
}

/** something with the canvas path methods (a canvas context, Path2D, the bounds recorder) */
type PathSink = { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; quadraticCurveTo(a: number, b: number, x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void; closePath(): void }

export function tracePath(sink: PathSink, path: GlyphPath) {
  for (const c of path) {
    if (c[0] === 'M') sink.moveTo(c[1], c[2])
    else if (c[0] === 'L') sink.lineTo(c[1], c[2])
    else if (c[0] === 'Q') sink.quadraticCurveTo(c[1], c[2], c[3], c[4])
    else if (c[0] === 'C') sink.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6])
    else sink.closePath()
  }
}
