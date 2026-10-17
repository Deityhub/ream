// A word-processing document as plain data: what PDF to Word writes and the Word preview reads. Lengths are in points.
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
  /** reading: RRGGBB behind the text, raised (super) or lowered (sub) */
  highlight?: string
  vertAlign?: 'super' | 'sub'
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
  /** least line height in points (leading); `lineExact` makes it exact. Reading: `lineFactor` is a multiple of single spacing */
  line?: number
  lineExact?: boolean
  lineFactor?: number
  /** reading: the list mark in front, already worked out ('•', '3.', 'b)') */
  marker?: string
  indentRight?: number
  indentLeft?: number
  /** first line, relative to the left indent; negative hangs */
  indentFirst?: number
  pageBreakBefore?: boolean
  /**
   * placed in a text box at a spot on the page, points from its top left, instead of in the flow; paragraphs that share one
   * `frame` object (the same object, one after the other) share the box. `h` is a first guess: the box grows to its text.
   */
  frame?: { x: number; y: number; w: number; h?: number; /** reading: what x and y count from (default the page) */ from?: { h: 'page' | 'margin'; v: 'page' | 'margin' | 'paragraph' } }
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
  /** put the picture at this place on the page instead of in the flow; behind the text unless `front` */
  at?: { x: number; y: number }
  front?: boolean
  /** reading: what `at` counts from (default the page) */
  from?: { h: 'page' | 'margin'; v: 'page' | 'margin' | 'paragraph' }
}

export type Block = Paragraph | Table | Picture

export type Section = {
  width: number
  height: number
  margins: { top: number; right: number; bottom: number; left: number }
  blocks: Block[]
}

export type DocModel = { sections: Section[]; title?: string }
