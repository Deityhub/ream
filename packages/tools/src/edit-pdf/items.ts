// What Edit PDF adds to pages, as plain data shared by the panel and the run (no engine code here). Places are
// fractions of the page as displayed (rotation applied), y from the top, like every other tool's selections.
import type { Rect } from '../rect.ts'
import type { InstalledFont } from '../fonts/book.ts'

export type Point = { x: number; y: number }

type Base = {
  id: string
  /** 0-based */
  page: number
  /** drawn at the same place on every page (a header, a logo) */
  everyPage?: boolean
}

export type TextItem = Base & {
  kind: 'text'
  box: Rect
  text: string
  /** a name from FONTS, or the family of an added font file */
  font: string
  /** points */
  size: number
  colour: string
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  /** line height as a multiple of the size */
  spacing: number
  /** 0..1 */
  opacity: number
}

export type ImageItem = Base & {
  kind: 'image'
  box: Rect
  /** PNG or JPEG (the panel turns other pictures into PNG) */
  data: Uint8Array
  type: 'image/png' | 'image/jpeg'
  /** quarter turns clockwise */
  turns: 0 | 1 | 2 | 3
  opacity: number
}

export type ShapeItem = Base & {
  kind: 'shape'
  shape: 'rect' | 'ellipse'
  box: Rect
  fill: string | null
  stroke: string | null
  /** points */
  width: number
  opacity: number
}

export type LineItem = Base & {
  kind: 'line'
  from: Point
  to: Point
  colour: string
  width: number
  arrow: 'none' | 'end' | 'both'
  opacity: number
}

export type DrawItem = Base & {
  kind: 'draw'
  strokes: Point[][]
  colour: string
  width: number
  /** wide, see-through and multiplied with the page, like a highlighter pen */
  highlighter: boolean
}

/** a box that covers what is under it (it does not remove it: Redact PDF does) */
export type WhiteoutItem = Base & { kind: 'whiteout'; box: Rect; colour: string }

/** highlight, underline or strike-through over the page's own text: one quad per line of it (upper left, upper right, lower left, lower right) */
export type MarkupItem = Base & { kind: 'markup'; type: 'highlight' | 'underline' | 'strike'; quads: [Point, Point, Point, Point][]; colour: string; text: string }

export type NoteItem = Base & { kind: 'note'; at: Point; text: string; colour: string }

/** a box that opens a web address, or goes to a page of the file */
export type LinkItem = Base & { kind: 'link'; box: Rect; url: string; target: number | null }

export type Item = TextItem | ImageItem | ShapeItem | LineItem | DrawItem | WhiteoutItem | MarkupItem | NoteItem | LinkItem

export type EditPdfOptions = {
  items: Item[]
  /** font files added in the panel, by the family they are listed under */
  fonts: InstalledFont[]
  /** bake highlights and notes into the pages too (links stay links) */
  flattenComments: boolean
}

export const defaultOptions: EditPdfOptions = { items: [], fonts: [], flattenComments: false }

/** the bundled fonts, by the name the font book knows them under; each has the letter widths of the font it is named after */
export const FONTS: { name: string; label: string; family: string; css: string }[] = [
  { name: 'Arial', label: 'Sans (Arimo)', family: 'arimo', css: 'Arimo' },
  { name: 'Times New Roman', label: 'Serif (Tinos)', family: 'tinos', css: 'Tinos' },
  { name: 'Courier New', label: 'Monospace (Cousine)', family: 'cousine', css: 'Cousine' },
  { name: 'Calibri', label: 'Carlito', family: 'carlito', css: 'Carlito' },
  { name: 'Cambria', label: 'Caladea', family: 'caladea', css: 'Caladea' },
]

/** the items drawn on one page */
export const itemsOn = (items: Item[], page: number) => items.filter((i) => i.page === page || i.everyPage)

/** '#rrggbb' as 0..1 parts */
export const colourOf = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0, 0, 0]
}

/** line height and where the first baseline sits, for a font's ascent and descent (as fractions of the size): the same rule as CSS, so the panel's text sits where the saved text does */
export function lineBox(size: number, spacing: number, ascent: number, descent: number) {
  const height = size * spacing
  return { height, baseline: (height - (ascent + descent) * size) / 2 + ascent * size }
}
