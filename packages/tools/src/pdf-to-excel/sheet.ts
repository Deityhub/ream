import type { Cell, Merge, Sheet, Style } from '@ream/office-core'
import type { Table } from '@ream/pdf-render'
import { parseNumber } from './number.ts'

/** the cells of one table placed at row `top` of a sheet; returns how many rows it used */
export function placeTable(t: Table, rows: (Cell | null)[][], merges: Merge[], top: number, convert: boolean, widths: number[], heights: (number | undefined)[]): number {
  for (let r = 0; r < t.rows; r++) rows[top + r] ??= []
  for (const c of t.cells) {
    const border = t.ruled ? ({ top: 'thin', right: 'thin', bottom: 'thin', left: 'thin' } as const) : undefined
    const num = convert ? parseNumber(c.text) : null
    const style: Style = {}
    if (c.bold) style.bold = true
    if (border) style.border = border
    if (c.text.includes('\n')) { style.wrap = true; style.valign = 'top' }
    if (num?.numFmt) style.numFmt = num.numFmt
    // text keeps the alignment it had on the page; a number with the default (left) alignment follows Excel and sits right
    if (c.align !== 'left') style.align = c.align
    const cell: Cell = { value: num ? num.value : c.text, ...(Object.keys(style).length ? { style } : {}) }
    rows[top + c.row][c.col] = cell
    if (c.rows > 1 || c.cols > 1) {
      merges.push({ row: top + c.row, col: c.col, rows: c.rows, cols: c.cols })
      // the covered cells carry the lines too, or Excel draws a gap in the border
      if (border) for (let r = 0; r < c.rows; r++) for (let k = 0; k < c.cols; k++) if (r || k) (rows[top + c.row + r] ??= [])[c.col + k] = { value: null, style: { border } }
    }
    const longest = Math.max(...c.text.split('\n').map((l) => l.length), 0)
    if (c.cols === 1) widths[c.col] = Math.max(widths[c.col] ?? 0, Math.min(60, Math.max(6, longest * 1.15 + 2)))
    const lines = c.text.split('\n').length
    if (lines > 1) heights[top + c.row] = Math.max(heights[top + c.row] ?? 0, 15 * lines)
  }
  return t.rows
}

/** one sheet from some tables, stacked with a blank row between */
export function sheetOf(name: string, tables: Table[], convert: boolean): Sheet {
  const rows: (Cell | null)[][] = []
  const merges: Merge[] = []
  const widths: number[] = []
  const heights: (number | undefined)[] = []
  let top = 0
  for (const t of tables) top += placeTable(t, rows, merges, top, convert, widths, heights) + 1
  return { name, rows, merges, colWidths: widths, rowHeights: heights }
}
