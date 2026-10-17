import type { Chart } from './chart-read.ts'
// Spreadsheets as plain data: what PDF to Excel writes and what Excel to PDF reads.
export type Edge = 'thin' | 'medium' | 'thick'

export type Style = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** points */
  size?: number
  font?: string
  /** RRGGBB */
  color?: string
  fill?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'center' | 'bottom'
  wrap?: boolean
  border?: { top?: Edge; right?: Edge; bottom?: Edge; left?: Edge }
  /** an Excel number format code such as "#,##0.00" or "0%" */
  numFmt?: string
}

export type Cell = {
  value: string | number | boolean | null
  style?: Style
  /** reading only: the value as Excel would show it (number format applied) */
  text?: string
}

export type Merge = { row: number; col: number; rows: number; cols: number }

/** a corner of a picture: the cell it is in, plus an offset into that cell in points */
export type Anchor = { col: number; row: number; dx: number; dy: number }

/** a picture floating over a sheet (reading only): from one cell corner to another, or from a corner with a size in points */
export type SheetPicture = { from: Anchor; to?: Anchor; width: number; height: number; bytes: Uint8Array; type: 'png' | 'jpeg' | 'other'; name: string }

/** a chart floating over a sheet (reading only), placed like a picture */
export type SheetChart = { from: Anchor; to?: Anchor; width: number; height: number; chart: Chart }

/** how a sheet prints, as saved in the file (reading only); Excel's defaults where the file says nothing */
export type PageSetup = {
  /** the sheet has page settings of its own (false: everything here is Excel's default) */
  saved: boolean
  /** portrait size in points; absent when the file doesn't name a paper size */
  paper?: [number, number]
  landscape: boolean
  /** points */
  margins: { left: number; right: number; top: number; bottom: number }
  /** percent, used when `fit` is absent */
  scale: number
  /** shrink to this many pages wide and tall (0: as many as it takes) */
  fit?: { wide: number; tall: number }
  gridlines: boolean
  /** centred across the page */
  centered: boolean
  /** the print area */
  area?: Merge
  /** rows repeated at the top of every page, first and last, 0-based */
  titleRows?: [number, number]
}

export type Sheet = {
  name: string
  /** rows[r][c], 0-based; short rows and null cells are empty */
  rows: (Cell | null)[][]
  /** Excel column width units (characters); missing entries use the default */
  colWidths?: (number | undefined)[]
  /** points; missing entries use the default */
  rowHeights?: (number | undefined)[]
  merges?: Merge[]
  hiddenRows?: number[]
  hiddenCols?: number[]
  landscape?: boolean
  /** points, reading only */
  defaultRowHeight?: number
  /** characters, reading only */
  defaultColWidth?: number
  hidden?: boolean
  /** reading only */
  page?: PageSetup
  /** reading only */
  pictures?: SheetPicture[]
  /** reading only */
  charts?: SheetChart[]
}
