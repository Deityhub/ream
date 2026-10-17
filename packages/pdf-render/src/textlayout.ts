// From placed characters to readable text: lines, words, columns, paragraphs and, for Markdown, headings, lists and
// bold or italic. Pure functions on plain data. It is a set of heuristics, not a layout engine: simple pages read well,
// tables and unusual layouts come out as lines of text.
import type { TextChar } from './textchars.ts'

export type LayoutOptions = {
  markdown: boolean
  /** the usual size of body text, for finding headings (Markdown only) */
  bodySize?: number
}

const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' }

/** the character as text: ligatures spelled out, no-break and odd spaces as spaces, controls dropped */
export function cleanText(s: string): string {
  let out = ''
  for (const ch of s) {
    if (LIGATURES[ch]) out += LIGATURES[ch]
    else if (ch === ' ' || ch === ' ' || ch === ' ' || ch === ' ' || ch === ' ') out += ' '
    else if (ch === '­') out += '-' // a soft hyphen only shows at a line end, where it means hyphenation
    else if (ch === '​' || ch === '‌' || ch === '‍' || ch === '﻿') continue
    else if (ch < ' ' || (ch >= '\u007f' && ch < ' ')) out += ch === '\t' || ch === '\n' ? ' ' : ''
    else out += ch
  }
  return out
}

export const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** a character with its place in the frame text reads left to right in */
export type Placed = Omit<TextChar, 'x0' | 'y0' | 'x1' | 'y1'> & { x0: number; x1: number; y: number; src: TextChar }

export type Line = { chars: Placed[]; y: number; size: number; x0: number; x1: number; text: string; /** the left edge of a bullet drawn as a shape in front of the line */ marker?: number }

/** the most common font size, weighted by characters, rounded to half a point; 0 when there is no text */
export function bodySizeOf(chars: { text: string; size: number; invisible: boolean }[], into: Map<number, number> = new Map()): number {
  for (const c of chars) if (c.text.trim() && !c.invisible) into.set(Math.round(c.size * 2) / 2, (into.get(Math.round(c.size * 2) / 2) ?? 0) + 1)
  let best = 0
  let count = 0
  for (const [k, v] of into) if (v > count) [best, count] = [k, v]
  return best
}

// ---------- lines ----------

/** chars on the same baseline, left to right; single linkage in y so a raised or lowered letter stays on its line */
export function toLines(chars: Placed[]): Line[] {
  const sorted = [...chars].sort((a, b) => a.y - b.y || a.x0 - b.x0)
  const groups: Placed[][] = []
  for (const c of sorted) {
    const g = groups[groups.length - 1]
    const last = g?.[g.length - 1]
    if (g && last && Math.abs(c.y - last.y) <= 0.4 * Math.max(c.size, last.size)) g.push(c)
    else groups.push([c])
  }
  return groups.map((g) => {
    const cs = g.sort((a, b) => a.x0 - b.x0)
    const size = median(cs.filter((c) => c.text.trim()).map((c) => c.size)) || cs[0].size
    return { chars: cs, y: median(cs.map((c) => c.y)), size, x0: cs[0].x0, x1: Math.max(...cs.map((c) => c.x1)), text: '' }
  })
}

/** the gap between two characters that counts as a word break, as a share of the font size */
export const WORD_GAP = 0.2

type Piece = { t: string; bold: boolean; italic: boolean }

/** the line's text, with spaces where the gaps are wide enough; `style` marks bold and italic runs for Markdown */
function lineText(line: Line, style: boolean): string {
  const pieces: Piece[] = []
  let prev: Placed | null = null
  let ends = '' // the text so far, to know whether a space is already there
  for (const c of line.chars) {
    const t = cleanText(c.text)
    if (!t) continue
    if (prev && !/\s$/.test(ends) && !/^\s/.test(t)) {
      const gap = c.x0 - prev.x1
      if (gap > WORD_GAP * Math.max(prev.size, c.size)) pieces.push({ t: gap > 3 * c.size ? '  ' : ' ', bold: false, italic: false })
    }
    pieces.push({ t, bold: c.bold, italic: c.italic })
    ends = t
    prev = c
  }
  if (!style) return pieces.map((p) => p.t).join('').trim()
  // white space takes the style of its neighbours when both agree, so a bold phrase is one run
  const blank = (p: Piece) => !p.t.trim()
  pieces.forEach((p, i) => {
    if (!blank(p)) return
    const before = pieces.slice(0, i).reverse().find((x) => !blank(x))
    const after = pieces.slice(i + 1).find((x) => !blank(x))
    const same = before && after && before.bold === after.bold && before.italic === after.italic
    p.bold = same ? before.bold : false
    p.italic = same ? before.italic : false
  })
  const runs: Piece[] = []
  for (const p of pieces) {
    const last = runs[runs.length - 1]
    if (last && last.bold === p.bold && last.italic === p.italic) last.t += p.t
    else runs.push({ ...p })
  }
  return runs
    .map((r) => {
      const text = r.t.replace(/([\\`*_])/g, '\\$1')
      const mark = r.bold && r.italic ? '***' : r.bold ? '**' : r.italic ? '*' : ''
      if (!mark || !text.trim()) return text
      return text.replace(/^(\s*)(.*?)(\s*)$/s, `$1${mark}$2${mark}$3`)
    })
    .join('')
    .trim()
}

// ---------- columns ----------

/** x positions that split the page's text into columns: wide empty strips with plenty of text on both sides */
function gutters(chars: Placed[], size: number): number[] {
  if (chars.length < 40) return []
  const lo = Math.floor(Math.min(...chars.map((c) => c.x0)))
  const hi = Math.ceil(Math.max(...chars.map((c) => c.x1)))
  const cover = new Uint32Array(Math.max(1, hi - lo + 1))
  for (const c of chars) for (let x = Math.floor(c.x0) - lo; x <= Math.min(cover.length - 1, Math.ceil(c.x1) - lo); x++) cover[x]++
  const need = Math.max(14, 1.5 * size)
  const out: number[] = []
  let start = -1
  for (let x = 0; x <= cover.length; x++) {
    const empty = x < cover.length && cover[x] === 0
    if (empty && start < 0) start = x
    if (!empty && start >= 0) {
      const mid = lo + (start + x) / 2
      const left = chars.filter((c) => (c.x0 + c.x1) / 2 < mid).length
      if (x - start >= need && start > 0 && left >= 0.15 * chars.length && chars.length - left >= 0.15 * chars.length) out.push(mid)
      start = -1
    }
  }
  return out
}

// ---------- paragraphs ----------

export const BULLET = /^(?:[•◦▪▫‣●○■□▸►·]|[-–—*])\s+/

export type Para = { lines: Line[] }

export function paragraphs(lines: Line[]): Para[] {
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i].y - lines[i - 1].y
    if (g >= 0.9 * lines[i].size && Math.abs(lines[i].size - lines[i - 1].size) < 0.5) gaps.push(g)
  }
  // the usual line spacing is the small end of the gaps: paragraph breaks and headings only make gaps bigger
  const lead = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 4)] ?? 0
  const out: Para[] = []
  for (const [i, line] of lines.entries()) {
    const prev = lines[i - 1]
    const text = lineText(line, false)
    const newPara =
      !prev ||
      (lead ? line.y - prev.y > 1.45 * lead : line.y - prev.y > 1.8 * line.size) ||
      line.y - prev.y > 4 * Math.max(line.size, prev.size) || // far apart whatever the usual spacing says (it may be built from very few gaps)
      Math.abs(line.size - prev.size) > 0.15 * prev.size ||
      BULLET.test(text) ||
      line.marker !== undefined
    if (newPara) out.push({ lines: [line] })
    else out[out.length - 1].lines.push(line)
  }
  return out
}

/** join wrapped lines; a hyphen at a line end followed by a lower-case letter is a split word */
function unwrap(texts: string[]): string {
  let out = ''
  for (const t of texts) {
    if (!out) out = t
    else if (/[A-Za-zÀ-ɏ]-$/.test(out) && /^[a-zß-ÿ]/.test(t)) out = out.slice(0, -1) + t
    else out += ' ' + t
  }
  return out
}

const escapeLineStart = (s: string) => s.replace(/^(#{1,6}\s|>|\+\s|-\s|\d+[.)]\s)/, '\\$1')

function paragraphText(p: Para, o: LayoutOptions, body: number): string {
  if (!o.markdown) return p.lines.map((l) => lineText(l, false)).join('\n')
  const plain = p.lines.map((l) => lineText(l, false))
  const size = median(p.lines.map((l) => l.size))
  const first = plain[0]
  // a short paragraph in clearly bigger type is a heading
  if (body && p.lines.length <= 2 && first.length <= 140 && size >= 1.15 * body) {
    const level = size >= 1.8 * body ? 1 : size >= 1.4 * body ? 2 : 3
    return `${'#'.repeat(level)} ${unwrap(plain).replace(/([\\`*_])/g, '\\$1')}`
  }
  const styled = unwrap(p.lines.map((l) => lineText(l, true)))
  const bullet = BULLET.exec(plain[0])
  if (bullet) return `- ${styled.replace(/^(?:\\\*|[•◦▪▫‣●○■□▸►·]|[-–—])\s+/, '')}`
  return escapeLineStart(styled)
}

/** the direction most of the text runs in, in degrees, snapped to a quarter turn (pages shown rotated carry sideways text) */
function dominantTurn(chars: TextChar[]): number {
  const votes = new Map<number, number>()
  for (const c of chars) if (c.text.trim()) votes.set(((Math.round(c.angle / 90) * 90) % 360 + 360) % 360, (votes.get(((Math.round(c.angle / 90) * 90) % 360 + 360) % 360) ?? 0) + 1)
  let best = 0
  let count = 0
  for (const [k, v] of votes) if (v > count) [best, count] = [k, v]
  return best
}

/**
 * The page's characters in reading position: turned so the main text runs left to right, letters printed twice at one spot
 * (fake bold) counted once, and split into upright text (`flat`) and text at other angles (`turned`). `turn` is the quarter
 * turn applied, so shapes can be put in the same frame.
 */
export function readingFrame(input: TextChar[]): { flat: Placed[]; turned: Placed[]; turn: number } {
  const turn = dominantTurn(input)
  const cos = Math.cos((turn * Math.PI) / 180)
  const sin = Math.sin((turn * Math.PI) / 180)
  const chars: Placed[] = input.map((c) => ({
    text: c.text,
    size: c.size,
    bold: c.bold,
    italic: c.italic,
    invisible: c.invisible,
    angle: ((c.angle - turn + 540) % 360) - 180,
    x0: c.x0 * cos + c.y0 * sin,
    x1: c.x1 * cos + c.y1 * sin,
    y: -c.x0 * sin + c.y0 * cos,
    src: c,
  }))
  const seen: Placed[] = []
  for (const c of chars) {
    if (!cleanText(c.text)) continue
    // letters printed twice at the same spot (fake bold) count once
    const dupe = seen.slice(-6).some((p) => p.text === c.text && Math.abs(p.x0 - c.x0) < 0.15 * c.size && Math.abs(p.y - c.y) < 0.15 * c.size)
    if (!dupe) seen.push(c)
  }
  return { flat: seen.filter((c) => Math.abs(c.angle) <= 15), turned: seen.filter((c) => Math.abs(c.angle) > 15), turn }
}

/** upright characters split into the page's text columns, left to right (one column when there is no gutter) */
export function readingColumns(flat: Placed[], size: number): Placed[][] {
  const columns: Placed[][] = []
  const edges = [-Infinity, ...gutters(flat, size), Infinity]
  for (let i = 0; i < edges.length - 1; i++) columns.push(flat.filter((c) => (c.x0 + c.x1) / 2 >= edges[i] && (c.x0 + c.x1) / 2 < edges[i + 1]))
  return columns
}

/** the text of one page. Characters drawn in render mode 3 are included: it is how scanned pages carry searchable text. */
export function layoutPage(input: TextChar[], o: LayoutOptions): string {
  const { flat, turned } = readingFrame(input)
  const body = o.bodySize ?? bodySizeOf(flat)
  const size = median(flat.map((c) => c.size)) || body || 10
  const columns = readingColumns(flat, size)
  const blocks: string[] = []
  for (const col of columns) {
    if (!col.length) continue
    for (const p of paragraphs(toLines(col))) blocks.push(paragraphText(p, o, body))
  }
  // text that is turned: each run in the order the file draws it, one block per direction, words found along the line
  let run: Placed[] = []
  const flush = () => {
    let out = ''
    run.forEach((c, i) => {
      const t = cleanText(c.text)
      const prev = run[i - 1]
      if (prev && !/\s$/.test(out) && !/^\s/.test(t) && Math.hypot(c.src.x0 - prev.src.x1, c.src.y0 - prev.src.y1) > WORD_GAP * Math.max(c.size, prev.size)) out += ' '
      out += t
    })
    if (out.trim()) blocks.push(out.trim())
    run = []
  }
  for (const c of turned) {
    if (run.length && Math.abs(run[run.length - 1].angle - c.angle) > 15) flush()
    run.push(c)
  }
  flush()
  return blocks.filter(Boolean).join('\n\n')
}
