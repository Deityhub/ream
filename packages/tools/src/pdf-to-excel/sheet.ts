import type { Cell, Edge, Merge, Sheet, Style } from '@ream/office-core'
import type { Shapes, Table, TableCell } from '@ream/pdf-render'
import { FACE, hex } from '../pdf-to-word/convert.ts'
import { parseNumber } from './number.ts'

type Box = { x0: number; y0: number; x1: number; y1: number }
type Side = 'top' | 'right' | 'bottom' | 'left'

/** points to Excel's column width in characters (7 px per digit plus 5 px of padding, 0.75 pt per px) */
const widthChars = (pts: number) => Math.max(2, Math.round(((pts / 0.75 - 5) / 7) * 100) / 100)

const edgeOf = (width: number): Edge => (width < 1.25 ? 'thin' : width < 2.25 ? 'medium' : 'thick')

/** where a cell sits on the page: the column edges, and the row edges of a ruled table or else the text's own box */
function cellBox(t: Table, c: TableCell): Box | null {
  const x0 = t.xs[c.col]
  const x1 = t.xs[c.col + c.cols]
  if (t.ys) return { x0, x1, y0: t.ys[c.row], y1: t.ys[c.row + c.rows] }
  return c.box ? { x0, x1, y0: c.box.y0, y1: c.box.y1 } : null
}

/** the colour of the smallest filled box under the cell's middle, leaving out white and boxes that hold the whole table (page or card backgrounds) */
function fillUnder(b: Box, t: Table, shapes: Shapes): string | undefined {
  const [x, y] = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]
  let best: { area: number; color: string } | undefined
  for (const f of shapes.fills) {
    if (x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1) continue
    if (f.x0 <= t.x0 + 1 && f.x1 >= t.x1 - 1 && f.y0 <= t.y0 + 1 && f.y1 >= t.y1 - 1) continue
    const area = (f.x1 - f.x0) * (f.y1 - f.y0)
    if (!best || area < best.area) best = { area, color: f.color }
  }
  // the recorder keeps canvas colours, rgb(r,g,b); a gradient is not a string and gives no fill
  const m = typeof best?.color === 'string' ? /^rgb\((\d+),(\d+),(\d+)\)$/.exec(best.color) : null
  const c = m && hex([+m[1], +m[2], +m[3]])
  return c && c !== 'FFFFFF' ? c : undefined
}

/** the sides of the cell that have a rule drawn along most of their length */
function bordersOf(b: Box, shapes: Shapes): Style['border'] {
  const out: NonNullable<Style['border']> = {}
  const along = (side: Side) => {
    const horizontal = side === 'top' || side === 'bottom'
    const at = side === 'top' ? b.y0 : side === 'bottom' ? b.y1 : side === 'left' ? b.x0 : b.x1
    const [from, to] = horizontal ? [b.x0, b.x1] : [b.y0, b.y1]
    let covered = 0
    let width = 0
    for (const r of shapes.rules) {
      const flat = r.y0 === r.y1
      if (flat !== horizontal || Math.abs((horizontal ? r.y0 : r.x0) - at) > 1.5 + r.width / 2) continue
      const lo = Math.max(from, horizontal ? r.x0 : r.y0)
      const hi = Math.min(to, horizontal ? r.x1 : r.y1)
      if (hi > lo) { covered += hi - lo; width = Math.max(width, r.width) }
    }
    if (covered >= 0.6 * (to - from)) out[side] = edgeOf(width)
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) along(side)
  return Object.keys(out).length ? out : undefined
}

/** the cells of one table placed at row `top` of a sheet; returns how many rows it used */
export function placeTable(t: Table, shapes: Shapes, rows: (Cell | null)[][], merges: Merge[], top: number, convert: boolean, widths: number[], heights: (number | undefined)[]): number {
  for (let r = 0; r < t.rows; r++) rows[top + r] ??= []
  // ponytail: the table is matched against the page's rules and fills in the page frame, so a table found in turned
  // text gets no fills or borders; map the shapes into the reading frame if that matters
  for (const c of t.cells) {
    const box = cellBox(t, c)
    const num = convert ? parseNumber(c.text) : null
    const style: Style = {}
    if (c.bold) style.bold = true
    if (c.italic) style.italic = true
    if (c.size) style.size = Math.round(c.size * 2) / 2
    if (c.size) style.font = c.face || FACE[c.kind ?? 'sans']
    if (c.color && c.color.some((v) => v > 8)) style.color = hex(c.color)
    const fill = box ? fillUnder(box, t, shapes) : undefined
    if (fill) style.fill = fill
    const border = box ? bordersOf(box, shapes) : undefined
    if (border) style.border = border
    if (c.text.includes('\n')) { style.wrap = true; style.valign = 'top' }
    else if (t.ys) style.valign = 'center'
    if (num?.numFmt) style.numFmt = num.numFmt
    // text keeps the alignment it had on the page; a number with the default (left) alignment follows Excel and sits right
    if (c.align !== 'left') style.align = c.align
    const cell: Cell = { value: num ? num.value : c.text, ...(Object.keys(style).length ? { style } : {}) }
    rows[top + c.row][c.col] = cell
    if (c.rows > 1 || c.cols > 1) {
      merges.push({ row: top + c.row, col: c.col, rows: c.rows, cols: c.cols })
      // the covered cells carry the lines and fill too, or Excel draws a gap in the border
      if (border || fill) for (let r = 0; r < c.rows; r++) for (let k = 0; k < c.cols; k++) if (r || k) (rows[top + c.row + r] ??= [])[c.col + k] = { value: null, style: { border, fill } }
    }
    // a column as wide as on the page, and at least as wide as its text with Excel's padding
    if (c.cols === 1) widths[c.col] = Math.max(widths[c.col] ?? 0, widthChars(Math.max(t.xs[c.col + 1] - t.xs[c.col], c.box ? c.box.x1 - c.box.x0 + 6 : 0)))
    const lines = c.text.split('\n').length
    if (lines > 1) heights[top + c.row] = Math.max(heights[top + c.row] ?? 0, (c.size || 11) * 1.3 * lines)
  }
  // rows of a ruled table are as tall as on the page
  if (t.ys) for (let r = 0; r < t.rows; r++) heights[top + r] = Math.max(heights[top + r] ?? 0, Math.round((t.ys[r + 1] - t.ys[r]) * 4) / 4)
  return t.rows
}

/** one sheet from some tables, stacked with a blank row between */
export function sheetOf(name: string, tables: Table[], shapes: Shapes, convert: boolean): Sheet {
  const rows: (Cell | null)[][] = []
  const merges: Merge[] = []
  const widths: number[] = []
  const heights: (number | undefined)[] = []
  let top = 0
  for (const t of tables) top += placeTable(t, shapes, rows, merges, top, convert, widths, heights) + 1
  return { name, rows, merges, colWidths: widths, rowHeights: heights }
}
