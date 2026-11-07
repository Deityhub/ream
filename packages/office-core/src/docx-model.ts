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
  /** reading: the text is the page number ('page'), the page count ('pages') or the page a bookmark is on ('pageref', with `ref`); `text` is what the file saved, to be replaced */
  field?: 'page' | 'pages' | 'pageref'
  /** reading: the bookmark a 'pageref' field is about */
  ref?: string
  /** reading: a link to a bookmark in this document */
  anchor?: string
  /** reading: the mark of a footnote or endnote (`text` is its number, already worked out) */
  note?: { id: string; kind: 'foot' | 'end' }
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
  /** reading: names of the bookmarks that start in this paragraph */
  bookmarks?: string[]
  /** reading: every tab stop of the paragraph (its style's included), by position from the left margin; a tab goes to the next one after where the text is */
  tabStops?: { pos: number; align: 'left' | 'center' | 'right' | 'decimal'; leader?: 'dot' | 'hyphen' | 'underscore' }[]
  /** reading: one entry for each tab character in the runs, in order; null when no stop is known there. `pos` counts from the left margin (missing: the margins themselves) */
  tabs?: ({ pos?: number; align: 'left' | 'center' | 'right' } | null)[]
  /**
   * placed in a text box at a spot on the page, points from its top left, instead of in the flow; paragraphs that share one
   * `frame` object (the same object, one after the other) share the box. `h` is a first guess: the box grows to its text.
   */
  frame?: { x: number; y: number; w: number; h?: number; /** reading: what x and y count from (default the page) */ from?: { h: 'page' | 'margin'; v: 'page' | 'margin' | 'paragraph' } }
}

/** a line of a cell's border: points wide, RRGGBB */
export type CellLine = { w: number; color: string } | null

export type TableCell = {
  paragraphs: Paragraph[]
  /** columns covered */
  cols?: number
  /** 'restart' starts a cell that continues down; 'continue' is a part under it */
  vMerge?: 'restart' | 'continue'
  fill?: string
  /** reading: where the text sits in a cell that is taller than it (default the top) */
  vAlign?: 'center' | 'bottom'
  /** reading: the lines on the cell's four sides, worked out from the table, its style and the cell (null: none); missing means the table's `borders` apply */
  border?: { top: CellLine; right: CellLine; bottom: CellLine; left: CellLine }
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
  /** reading: where the table sits across the page: as aligned, or from the left margin by `indent` (the cell margin Word outdents it by in older documents included) */
  align?: 'left' | 'center' | 'right'
  indent?: number
  /** reading: rows that must stay on one page (cantSplit); the others are split between lines when a page ends in them */
  noSplit?: boolean[]
  /** reading: the first rows are headings that repeat at the top of every page the table continues on */
  headerRows?: number
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
  /** reading: for even-numbered pages when the document says odd and even pages differ */
  evenHeader?: Block[]
  evenFooter?: Block[]
  titlePg?: boolean
  /** reading: how the section starts (default on a new page) */
  type?: 'continuous' | 'nextPage' | 'evenPage' | 'oddPage'
  /** reading: the number of its first page when it restarts the numbering, and the look of the numbers */
  pageStart?: number
  pageFormat?: 'decimal' | 'lowerRoman' | 'upperRoman' | 'lowerLetter' | 'upperLetter'
  /** reading: text in columns: their widths (points) and the space between, and a line between them */
  columns?: { widths: number[]; space: number[]; line: boolean }
}

/** reading: a font file the document carries, for the family, weight and slant it is for */
export type EmbeddedFont = { name: string; bold: boolean; italic: boolean; bytes: Uint8Array }

export type DocModel = {
  sections: Section[]
  title?: string
  /** reading: even pages have their own headers and footers */
  evenAndOdd?: boolean
  /** reading: where a tab goes when no stop is set, points */
  defaultTab?: number
  /** reading: the text of footnotes (`foot:2`) and endnotes (`end:2`), by kind and id */
  notes?: Record<string, Paragraph[]>
  /** reading: fonts stored in the file (Google Docs saves the ones it uses) */ fonts?: EmbeddedFont[] }
