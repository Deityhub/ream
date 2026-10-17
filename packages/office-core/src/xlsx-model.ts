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
}
