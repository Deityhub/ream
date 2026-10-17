// Finding tables on a page: grids drawn with ruled lines first, then text laid out in aligned columns. Heuristics on plain
// data (characters and rules as displayed), tested on synthetic pages. It will miss irregular tables and scans.
import type { PageChars } from './textchars.ts'
import { cleanText, median, readingFrame, toLines, WORD_GAP, type Line, type Placed } from './textlayout.ts'
import type { Rule } from './shapes.ts'

export type TableCell = {
  row: number
  col: number
  /** how many rows and columns the cell covers (merged cells) */
  rows: number
  cols: number
  text: string
  bold: boolean
  align: 'left' | 'center' | 'right'
  /** the usual type size of the cell's text, points (0 for an empty cell) */
  size: number
  /** where the text sits across the page (internal: used to work out column alignment) */
  ink?: [number, number] | null
  /** the box the cell's text covers on the page (top of the first line to below the last), absent for an empty cell */
  box?: { x0: number; y0: number; x1: number; y1: number }
  /** the text's colour and the font's name and kind, from its first letter */
  color?: [number, number, number]
  face?: string
  kind?: 'sans' | 'serif' | 'mono'
  italic?: boolean
}

export type Table = {
  /** where the table sits in the page frame (points, y down) */
  x0: number
  y0: number
  x1: number
  y1: number
  rows: number
  cols: number
  /** the x of each column edge, left to right: `cols + 1` values */
  xs: number[]
  /** the y of each row edge, top to bottom: `rows + 1` values; only for tables drawn with lines */
  ys?: number[]
  /** drawn with lines (true) or found from the way the text lines up (false) */
  ruled: boolean
  cells: TableCell[]
}

/** a run of text on one line with no wide gap inside, the unit tables are built from */
type Piece = { text: string; x0: number; x1: number; y: number; size: number; bold: boolean; italic: boolean; color?: [number, number, number]; face?: string; kind?: 'sans' | 'serif' | 'mono' }

const COLUMN_GAP = 1.0 // a gap wider than this many font sizes ends a piece
const TOL = 1.5 // points: lines closer than this are the same line
const MIN_ROWS = 3 // text-aligned tables

const cluster = (values: number[], tol = TOL): number[] => {
  const out: number[][] = []
  for (const v of [...values].sort((a, b) => a - b)) {
    const g = out[out.length - 1]
    if (g && v - g[g.length - 1] <= tol) g.push(v)
    else out.push([v])
  }
  return out.map((g) => g.reduce((s, x) => s + x, 0) / g.length)
}

/** one line cut into pieces at wide gaps */
function pieces(line: Line, gapEm = COLUMN_GAP): Piece[] {
  const out: (Piece & { b: number; n: number })[] = []
  let cur: (Piece & { b: number; n: number }) | null = null
  let prev: Placed | null = null
  let ends = ''
  for (const c of line.chars) {
    const t = cleanText(c.text)
    if (!t) continue
    const gap = prev ? c.x0 - prev.x1 : 0
    if (!cur || (prev && gap > gapEm * Math.max(prev.size, c.size))) {
      cur = { text: '', x0: c.x0, x1: c.x1, y: line.y, size: c.size, bold: false, italic: c.italic, color: c.src.color, face: c.src.face, kind: c.src.kind, b: 0, n: 0 }
      out.push(cur)
      ends = ''
    } else if (prev && gap > WORD_GAP * Math.max(prev.size, c.size) && !/\s$/.test(ends) && !/^\s/.test(t)) cur.text += ' '
    cur.text += t
    cur.x1 = Math.max(cur.x1, c.x1)
    if (t.trim()) {
      cur.n++
      if (c.bold) cur.b++
    }
    ends = t
    prev = c
  }
  return out
    .map((p) => ({ text: p.text.trim(), x0: p.x0, x1: p.x1, y: p.y, size: p.size, bold: p.n > 0 && p.b / p.n >= 0.6, italic: p.italic, color: p.color, face: p.face, kind: p.kind }))
    .filter((p) => p.text)
}

// ---------- ruled tables ----------

type Seg = { a: number; lo: number; hi: number }

const isLight = (css: string) => {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(css)
  if (m) return 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3] > 235
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css)?.[1]
  if (!h) return false
  const f = h.length === 3 ? [...h].map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2] > 235
}

/** rules in the reading frame, merged into long segments: horizontals (a = y) and verticals (a = x) */
function segments(rules: Rule[], turn: number): { h: Seg[]; v: Seg[] } {
  const cos = [1, 0, -1, 0][(turn / 90) % 4]
  const sin = [0, 1, 0, -1][(turn / 90) % 4]
  const hRaw: Seg[] = []
  const vRaw: Seg[] = []
  for (const r of rules) {
    if (r.width > 6 || isLight(r.color)) continue
    const ax = r.x0 * cos + r.y0 * sin
    const ay = -r.x0 * sin + r.y0 * cos
    const bx = r.x1 * cos + r.y1 * sin
    const by = -r.x1 * sin + r.y1 * cos
    if (Math.abs(ay - by) <= Math.abs(ax - bx)) hRaw.push({ a: (ay + by) / 2, lo: Math.min(ax, bx), hi: Math.max(ax, bx) })
    else vRaw.push({ a: (ax + bx) / 2, lo: Math.min(ay, by), hi: Math.max(ay, by) })
  }
  const merge = (raw: Seg[]): Seg[] => {
    const out: Seg[] = []
    for (const a of cluster(raw.map((s) => s.a), 1.2)) {
      const mine = raw.filter((s) => Math.abs(s.a - a) <= 1.2).sort((p, q) => p.lo - q.lo)
      let cur: Seg | null = null
      for (const s of mine) {
        if (cur && s.lo <= cur.hi + 2) cur.hi = Math.max(cur.hi, s.hi)
        else out.push((cur = { a, lo: s.lo, hi: s.hi }))
      }
    }
    return out.filter((s) => s.hi - s.lo >= 6)
  }
  return { h: merge(hRaw), v: merge(vRaw) }
}

const coverage = (segs: Seg[], a: number, lo: number, hi: number) => {
  let cov = 0
  for (const s of segs) if (Math.abs(s.a - a) <= TOL) cov += Math.max(0, Math.min(hi, s.hi) - Math.max(lo, s.lo))
  return Math.min(1, cov / (hi - lo || 1))
}

/** a grid of cells from connected rules; merged cells where the line between two cells is missing */
function ruledTables(h: Seg[], v: Seg[], all: Piece[]): { table: Table; used: Set<Piece> }[] {
  // connected sets of lines (a horizontal and a vertical touch)
  const parent = [...h, ...v].map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  h.forEach((hs, i) =>
    v.forEach((vs, j) => {
      if (vs.a >= hs.lo - 2 && vs.a <= hs.hi + 2 && hs.a >= vs.lo - 2 && hs.a <= vs.hi + 2) parent[find(i)] = find(h.length + j)
    }),
  )
  const groups = new Map<number, { h: Seg[]; v: Seg[] }>()
  h.forEach((s, i) => (groups.get(find(i)) ?? groups.set(find(i), { h: [], v: [] }).get(find(i))!).h.push(s))
  v.forEach((s, j) => (groups.get(find(h.length + j)) ?? groups.set(find(h.length + j), { h: [], v: [] }).get(find(h.length + j))!).v.push(s))

  const out: { table: Table; used: Set<Piece> }[] = []
  for (const g of groups.values()) {
    if (!g.h.length || !g.v.length) continue
    const xs = cluster(g.v.map((s) => s.a))
    let ys = cluster(g.h.map((s) => s.a))
    if (xs.length < 2 || ys.length < 2) continue
    const box = { x0: xs[0], x1: xs[xs.length - 1], y0: ys[0], y1: ys[ys.length - 1] }
    if (box.x1 - box.x0 < 20 || box.y1 - box.y0 < 8) continue
    const inside = all.filter((p) => (p.x0 + p.x1) / 2 >= box.x0 - 1 && (p.x0 + p.x1) / 2 <= box.x1 + 1 && p.y - 0.3 * p.size >= box.y0 - 1 && p.y - 0.3 * p.size <= box.y1 + 1)
    // only top and bottom lines: the rows are the text lines between them
    let synthetic = false
    if (ys.length === 2) {
      const lines = cluster(inside.map((p) => p.y), 0.4 * (median(inside.map((p) => p.size)) || 10))
      if (lines.length < 2) continue
      ys = [ys[0], ...lines.slice(1).map((y, i) => (y + lines[i]) / 2), ys[1]]
      synthetic = true
    }
    const rows = ys.length - 1
    const cols = xs.length - 1
    if (rows < 2 || cols < 2) continue

    const cellParent = Array.from({ length: rows * cols }, (_, i) => i)
    const cf = (i: number): number => (cellParent[i] === i ? i : (cellParent[i] = cf(cellParent[i])))
    const union = (a: number, b: number) => void (cellParent[cf(a)] = cf(b))
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // no vertical line to the right of the cell: it continues into the next column
        if (c + 1 < cols && coverage(g.v, xs[c + 1], ys[r], ys[r + 1]) < 0.6) union(r * cols + c, r * cols + c + 1)
        if (r + 1 < rows && !synthetic && coverage(g.h, ys[r + 1], xs[c], xs[c + 1]) < 0.6) union(r * cols + c, (r + 1) * cols + c)
      }
    }
    const sets = new Map<number, number[]>()
    for (let i = 0; i < rows * cols; i++) (sets.get(cf(i)) ?? sets.set(cf(i), []).get(cf(i))!).push(i)
    const cellsOut: TableCell[] = []
    const used = new Set<Piece>()
    const place = (r0: number, c0: number, r1: number, c1: number) => {
      const rect = { x0: xs[c0], x1: xs[c1 + 1], y0: ys[r0], y1: ys[r1 + 1] }
      const mine = inside.filter((p) => !used.has(p) && (p.x0 + p.x1) / 2 >= rect.x0 && (p.x0 + p.x1) / 2 < rect.x1 && p.y - 0.3 * p.size >= rect.y0 && p.y - 0.3 * p.size < rect.y1)
      mine.forEach((p) => used.add(p))
      cellsOut.push({ row: r0, col: c0, rows: r1 - r0 + 1, cols: c1 - c0 + 1, ...cellText(mine, rect.x1 - rect.x0), align: 'left' })
    }
    for (const members of sets.values()) {
      const rs = members.map((i) => Math.floor(i / cols))
      const cs = members.map((i) => i % cols)
      const [r0, r1, c0, c1] = [Math.min(...rs), Math.max(...rs), Math.min(...cs), Math.max(...cs)]
      if (members.length === (r1 - r0 + 1) * (c1 - c0 + 1)) place(r0, c0, r1, c1)
      else for (const i of members) place(Math.floor(i / cols), i % cols, Math.floor(i / cols), i % cols) // an irregular merge: keep the cells apart
    }
    alignColumns(cellsOut, cols)
    out.push({ table: { ...box, rows, cols, xs, ys, ruled: true, cells: cellsOut }, used })
  }
  return out
}

/** the text of the pieces of one cell, lines top to bottom; short lines break, long ones are wrapped text and join with a space */
function cellText(ps: Piece[], width: number): Pick<TableCell, 'text' | 'bold' | 'size' | 'ink' | 'box' | 'color' | 'face' | 'kind' | 'italic'> {
  const lines: Piece[][] = []
  for (const p of [...ps].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    const l = lines[lines.length - 1]
    if (l && Math.abs(l[0].y - p.y) <= 0.4 * Math.max(l[0].size, p.size)) l.push(p)
    else lines.push([p])
  }
  let text = ''
  lines.forEach((l, i) => {
    const t = l.sort((a, b) => a.x0 - b.x0).map((p) => p.text).join(' ')
    if (i) text += lines[i - 1].reduce((n, p) => Math.max(n, p.x1), 0) - lines[i - 1][0].x0 >= 0.7 * width ? ' ' : '\n'
    text += t
  })
  if (!ps.length) return { text, bold: false, size: 0, ink: null }
  const box = { x0: Math.min(...ps.map((p) => p.x0)), x1: Math.max(...ps.map((p) => p.x1)), y0: Math.min(...ps.map((p) => p.y - p.size)), y1: Math.max(...ps.map((p) => p.y + 0.25 * p.size)) }
  const f = ps[0]
  return { text, bold: ps.every((p) => p.bold), italic: f.italic, size: median(ps.map((p) => p.size)), ink: [box.x0, box.x1], box, color: f.color, face: f.face, kind: f.kind }
}

/**
 * Each column gets the alignment its text agrees on: the edge (left, right) or the middle that varies least from row to row.
 * Ties go left. The header row is left out of the vote when there are other rows, since headers are often centred.
 */
function alignColumns(cells: TableCell[], cols: number): void {
  for (let c = 0; c < cols; c++) {
    const col = cells.filter((x) => x.col === c && x.cols === 1 && x.ink)
    const body = col.some((x) => x.row > 0) && col.length > 2 ? col.filter((x) => x.row > 0) : col
    if (body.length < 2) continue
    const spread = (f: (i: [number, number]) => number) => Math.max(...body.map((x) => f(x.ink!))) - Math.min(...body.map((x) => f(x.ink!)))
    const left = spread((i) => i[0])
    const right = spread((i) => i[1])
    const mid = spread((i) => (i[0] + i[1]) / 2)
    const align = left <= right + 1.5 && left <= mid + 1.5 ? 'left' : right <= mid ? 'right' : 'center'
    for (const x of col) x.align = align
    for (const x of cells) if (x.col === c && x.cols === 1 && !x.ink) x.align = align
  }
}

// ---------- tables from aligned text ----------

type Row = { pieces: Piece[]; y: number; size: number }

/** runs of consecutive lines that each hold two or more pieces, with the single-piece lines that sit between them */
function textRuns(rows: Row[]): Row[][] {
  const runs: Row[][] = []
  let cur: Row[] = []
  const flush = () => {
    while (cur.length && cur[cur.length - 1].pieces.length < 2) cur.pop()
    if (cur.length >= MIN_ROWS) runs.push(cur)
    cur = []
  }
  for (const r of rows) {
    const prev = cur[cur.length - 1]
    if (prev && r.y - prev.y > 3 * Math.max(r.size, prev.size)) flush()
    if (r.pieces.length >= 2) cur.push(r)
    else if (cur.length) {
      // a single piece is a section row only if more table follows; it is dropped again at the end of the run if not
      cur.push(r)
    }
  }
  flush()
  return runs
}

function textTable(run: Row[]): Table | null {
  const counts = new Map<number, number>()
  for (const r of run) if (r.pieces.length >= 2) counts.set(r.pieces.length, (counts.get(r.pieces.length) ?? 0) + 1)
  let modal = 0
  let best = 0
  for (const [k, n] of counts) if (n > best || (n === best && k > modal)) [modal, best] = [k, n]
  if (modal < 2 || best < 2) return null
  // columns: the x-ranges of the pieces of rows that have the usual number of pieces, overlapping ranges joined
  const spans = run.filter((r) => r.pieces.length === modal).flatMap((r) => r.pieces.map((p) => [p.x0, p.x1] as [number, number])).sort((a, b) => a[0] - b[0])
  const bands: [number, number][] = []
  for (const [a, b] of spans) {
    const last = bands[bands.length - 1]
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else bands.push([a, b])
  }
  if (bands.length < 2) return null
  const cells: TableCell[] = []
  const grid = new Map<string, Piece[]>()
  run.forEach((row, r) => {
    for (const p of row.pieces) {
      const hit = bands.map((b, i) => (Math.min(p.x1, b[1]) - Math.max(p.x0, b[0]) > 0 ? i : -1)).filter((i) => i >= 0)
      if (!hit.length) {
        // in the gutter: the nearest column takes it
        const c = (p.x0 + p.x1) / 2
        hit.push(bands.map((b, i) => [Math.abs((b[0] + b[1]) / 2 - c), i]).sort((a, b) => a[0] - b[0])[0][1])
      }
      const key = `${r}:${hit[0]}:${hit[hit.length - 1]}`
      ;(grid.get(key) ?? grid.set(key, []).get(key)!).push(p)
    }
  })
  for (const [key, ps] of grid) {
    const [r, c0, c1] = key.split(':').map(Number)
    const x0 = bands[c0][0]
    const x1 = bands[c1][1]
    cells.push({ row: r, col: c0, rows: 1, cols: c1 - c0 + 1, ...cellText(ps, x1 - x0), align: 'left' })
  }
  // two columns of running text have the same shape as a two-column table, but their cells are sentences
  if (cells.filter((c) => c.text.split(/\s+/).length >= 6).length >= 0.7 * cells.length) return null
  alignColumns(cells, bands.length)
  const all = run.flatMap((r) => r.pieces)
  const xs = [bands[0][0] - 3, ...bands.slice(1).map((b, i) => (b[0] + bands[i][1]) / 2), bands[bands.length - 1][1] + 3]
  return { x0: Math.min(...all.map((p) => p.x0)), x1: Math.max(...all.map((p) => p.x1)), y0: run[0].y - run[0].size, y1: run[run.length - 1].y, rows: run.length, cols: bands.length, xs, ruled: false, cells }
}

/** the tables of a page, top to bottom */
export function findTables(page: PageChars): Table[] {
  const { flat, turn } = readingFrame(page.chars)
  const usable = flat.filter((c) => !c.invisible)
  const lines = toLines(usable)
  const all = lines.flatMap((l) => pieces(l, 0.6)) // tight gaps for ruled cells: a cell may hold two words far apart
  const { h, v } = segments(page.shapes.rules, turn)
  const ruled = ruledTables(h, v, all)
  // text outside ruled tables, split into pieces at column-sized gaps
  const inRuled = (l: Line) => ruled.some((r) => l.y - 0.3 * l.size >= r.table.y0 - 1 && l.y - 0.3 * l.size <= r.table.y1 + 1 && l.x0 >= r.table.x0 - 1 && l.x0 <= r.table.x1 + 1)
  const rows: Row[] = lines.filter((l) => !inRuled(l)).map((l) => ({ pieces: pieces(l), y: l.y, size: l.size })).filter((r) => r.pieces.length)
  const tables = ruled.map((r) => r.table)
  for (const run of textRuns(rows)) {
    const t = textTable(run)
    if (t) tables.push(t)
  }
  for (const t of tables) for (const c of t.cells) delete c.ink
  return tables.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
}
