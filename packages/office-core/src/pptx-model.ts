// A presentation as plain data: what PDF to PowerPoint writes and PowerPoint to PDF reads. Lengths are in points.
import type { Run } from './docx-model.ts'

export type SlideRun = Run

export type SlidePara = {
  runs: SlideRun[]
  align?: 'left' | 'center' | 'right' | 'justify'
  /** a bullet in front: a character, or 'number' for 1. 2. 3. */
  bullet?: string
  /** points from the left of the text area; `indent` moves the first line (negative hangs) */
  marginLeft?: number
  indent?: number
  /** line height: points (exact), or a factor of the type size when `lineFactor` */
  line?: number
  lineFactor?: number
  before?: number
  after?: number
  /** the size of the paragraph mark, for empty paragraphs */
  size?: number
}

export type SlideBox = {
  kind: 'text'
  x: number
  y: number
  w: number
  h: number
  paragraphs: SlidePara[]
  anchor?: 'top' | 'middle' | 'bottom'
  wrap?: boolean
  /** space inside the box edge, points (left, top, right, bottom) */
  insets?: [number, number, number, number]
  /** fill (with its opacity 0..1) and line of the shape itself */
  fill?: string
  fillAlpha?: number
  line?: { color: string; width: number; dash?: 'dash' | 'dot' | 'dashDot' }
  /** the type was shrunk by PowerPoint to fit the box: sizes are multiplied by this, line gaps reduced by `lineReduction` */
  fontScale?: number
  lineReduction?: number
  /** 'rect' (the default), 'ellipse', 'roundRect' */
  geometry?: string
  rotation?: number
  name?: string
}

export type SlidePicture = { kind: 'pic'; x: number; y: number; w: number; h: number; bytes: Uint8Array; /** 'other' (gif, bmp...) is for readers; the writer takes png and jpeg */ type: 'png' | 'jpeg' | 'other'; name?: string; alt?: string; /** the part of the picture shown, as shares cut from each side */ crop?: [number, number, number, number]; rotation?: number }

export type SlideLine = { kind: 'line'; x0: number; y0: number; x1: number; y1: number; color: string; width: number; dash?: 'dash' | 'dot' | 'dashDot' }

export type SlideTableCell = {
  paragraphs: SlidePara[]
  cols?: number
  rows?: number
  /** a part covered by a cell that spans over it: along the row (h), down the column (v) or both */
  covered?: 'h' | 'v' | 'hv'
  fill?: string
  /** lines on all four sides (writing) */
  border?: boolean
  /** lines per side (reading); `l` left, `r` right, `t` top, `b` bottom */
  edges?: Partial<Record<'l' | 'r' | 't' | 'b', { color: string; width: number }>>
  /** space inside the cell, points: left, top, right, bottom */
  insets?: [number, number, number, number]
  anchor?: 'top' | 'middle' | 'bottom'
}

export type SlideTable = { kind: 'table'; x: number; y: number; w: number; h: number; colWidths: number[]; rowHeights: number[]; cells: SlideTableCell[][] }

/** something in the file that is not drawn (a chart, a diagram): a place holder so the gap is visible */
export type SlideUnsupported = { kind: 'unsupported'; x: number; y: number; w: number; h: number; what: string }

export type SlideShape = SlideBox | SlidePicture | SlideLine | SlideTable | SlideUnsupported

export type Slide = { background?: string; backgroundPicture?: { bytes: Uint8Array; type: 'png' | 'jpeg' | 'other'; name: string }; shapes: SlideShape[]; hidden?: boolean }

export type Deck = { width: number; height: number; slides: Slide[]; title?: string }
