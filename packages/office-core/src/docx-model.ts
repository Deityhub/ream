// A word-processing document as plain data: what PDF to Word writes. Lengths are in points.
export type Run = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** points */
  size?: number
  /** RRGGBB */
  color?: string
  /** a font name; Word substitutes when it is not installed */
  font?: string
}

export type Paragraph = {
  kind: 'p'
  runs: Run[]
  align?: 'left' | 'center' | 'right' | 'justify'
  /** a heading style (also what Word's navigation pane lists) */
  heading?: 1 | 2 | 3 | 4 | 5 | 6
  bullet?: boolean
  before?: number
  after?: number
  /** least line height in points (leading) */
  line?: number
  indentLeft?: number
  /** first line, relative to the left indent; negative hangs */
  indentFirst?: number
  pageBreakBefore?: boolean
}

export type TableCell = {
  paragraphs: Paragraph[]
  /** columns covered */
  cols?: number
  /** 'restart' starts a cell that continues down; 'continue' is a part under it */
  vMerge?: 'restart' | 'continue'
  fill?: string
}

export type Table = {
  kind: 'table'
  /** points, one per grid column */
  colWidths: number[]
  rows: TableCell[][]
  /** lines around every cell */
  borders: boolean
  /** least height of each row, points (missing: as tall as the text needs) */
  rowHeights?: number[]
  /** space below the table, points */
  after?: number
}

export type Picture = {
  kind: 'picture'
  bytes: Uint8Array
  type: 'png' | 'jpeg'
  width: number
  height: number
  alt?: string
  /** put the picture at this place on the page, behind the text, instead of in the flow */
  at?: { x: number; y: number }
}

export type Block = Paragraph | Table | Picture

export type Section = {
  width: number
  height: number
  margins: { top: number; right: number; bottom: number; left: number }
  blocks: Block[]
}

export type DocModel = { sections: Section[]; title?: string }
