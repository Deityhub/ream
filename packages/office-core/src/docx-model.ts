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
  /** reading: a web or mail address the text links to */
  link?: string
  /** reading: the text is the page number ('page') or the page count ('pages'); `text` is what the file saved, to be replaced */
  field?: 'page' | 'pages'
  /** reading: a picture in the line, like a character (`text` is empty): it sits on the baseline, grows the line, and goes where the paragraph's alignment puts it */
  picture?: Picture
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
  /** reading: keep with the next paragraph, keep all lines on one page, widow and orphan control (on unless `false`) */
  keepNext?: boolean
  keepLines?: boolean
  widowControl?: boolean
  /** reading: one entry for each tab character in the runs, in order; null when no stop is known there. `pos` counts from the left margin (missing: the margins themselves) */
  tabs?: ({ pos?: number; align: 'left' | 'center' | 'right' } | null)[]
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
  /** reading: where the text sits in a cell that is taller than it (default the top) */
  vAlign?: 'center' | 'bottom'
  /** reading: room between the cell's edges and its text, points (Word's default: 5.4 at the sides, none above and below) */
  pad?: { top: number; right: number; bottom: number; left: number }
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
  /** reading: placed by alignment (in what `from` names) instead of by `at` */
  align?: { h?: 'left' | 'center' | 'right'; v?: 'top' | 'center' | 'bottom' }
  /**
   * reading: how text goes around a placed picture: 'square' (also what tight and through wrapping become: the picture's box),
   * or 'topBottom' (no text beside it). Missing: text ignores it and the picture is drawn behind it, or in front when `front`.
   */
  wrap?: 'square' | 'topBottom'
  /** reading: with 'square', the side text may use: both (the wider piece of each line), only the left or right, or the largest */
  wrapText?: 'both' | 'left' | 'right' | 'largest'
  /** reading: room kept clear around it, points */
  dist?: { top: number; bottom: number; left: number; right: number }
  /**
   * reading: what part of the picture shows in its box, as shares of the picture cut from each side. A negative share is
   * empty room added there (a thin line picture in a tall box, as Google Docs makes for dividers).
   */
  crop?: { l: number; t: number; r: number; b: number }
}

export type Block = Paragraph | Table | Picture

export type Section = {
  width: number
  height: number
  /** `header` and `footer` are the distances from the page's edge to the header and footer */
  margins: { top: number; right: number; bottom: number; left: number; header?: number; footer?: number }
  blocks: Block[]
  /** reading: what repeats at the top and bottom of every page of the section; `first*` is for its first page when `titlePg` */
  header?: Block[]
  footer?: Block[]
  firstHeader?: Block[]
  firstFooter?: Block[]
  titlePg?: boolean
}

/** reading: a font file the document carries, for the family, weight and slant it is for */
export type EmbeddedFont = { name: string; bold: boolean; italic: boolean; bytes: Uint8Array }

export type DocModel = { sections: Section[]; title?: string; /** reading: fonts stored in the file (Google Docs saves the ones it uses) */ fonts?: EmbeddedFont[] }
