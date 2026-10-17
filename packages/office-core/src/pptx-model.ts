import type { Chart } from './chart-read.ts'
// A presentation as plain data: what PDF to PowerPoint writes and PowerPoint to PDF reads. Lengths are in points.
import type { Run } from './docx-model.ts'

export type SlideRun = Run & {
  /** shown in capitals ('all') or small capitals */
  caps?: 'all' | 'small'
  /** extra space between letters, points */
  spacing?: number
  /** raised (positive) or lowered, as a share of the size: superscript is about 0.3 */
  baseline?: number
  /** RRGGBB behind the text */
  highlight?: string
  /** 0..1 */
  alpha?: number
}

/** how an area is filled: one colour, a gradient, or a picture stretched over it */
export type Paint =
  | { type: 'solid'; color: string; alpha?: number }
  | { type: 'gradient'; stops: { at: number; color: string; alpha?: number }[]; /** linear: degrees clockwise from left to right */ angle?: number; /** radial: where it starts, shares of the box */ center?: [number, number] }
  | { type: 'picture'; bytes: Uint8Array; kind: 'png' | 'jpeg' | 'other'; name: string; crop?: [number, number, number, number]; alpha?: number }

export type LineEnd = 'triangle' | 'arrow' | 'stealth' | 'oval' | 'diamond'

export type Stroke = { color: string; width: number; dash?: 'dash' | 'dot' | 'dashDot'; alpha?: number; head?: LineEnd; tail?: LineEnd }

/** a drawn outline in its own units: `w` x `h` maps onto the shape's box; segments are moves, lines, cubic curves and closes */
export type CustomPath = { w: number; h: number; fill: boolean; stroke: boolean; segs: (['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z'])[] }

/** a matrix on the slide's points (x' = a x + c y + e, y' = b x + d y + f) that a group's turn or mirror puts on the shapes in it */
export type Xform = [number, number, number, number, number, number]

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
  /** the bullet's own font, colour (RRGGBB) and size (share of the text's) */
  bulletFont?: string
  bulletColor?: string
  bulletScale?: number
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
  line?: Stroke
  /** reading: any fill (gradient, picture, see-through colour); `fill` stays for writing a plain colour */
  paint?: Paint
  /** preset shape adjustments as the file gives them (gd name -> value, mostly 1/100000ths) */
  adjust?: Record<string, number>
  /** the outline of a custom shape */
  paths?: CustomPath[]
  flipH?: boolean
  flipV?: boolean
  /** text running down ('vert', turned a quarter clockwise) or up ('vert270') */
  vertical?: 'vert' | 'vert270'
  xform?: Xform
  /** the type was shrunk by PowerPoint to fit the box: sizes are multiplied by this, line gaps reduced by `lineReduction` */
  fontScale?: number
  lineReduction?: number
  /** 'rect' (the default), 'ellipse', 'roundRect' */
  geometry?: string
  rotation?: number
  name?: string
}

export type SlidePicture = { kind: 'pic'; x: number; y: number; w: number; h: number; bytes: Uint8Array; /** 'other' (gif, bmp...) is for readers; the writer takes png and jpeg */ type: 'png' | 'jpeg' | 'other'; name?: string; alt?: string; /** the part of the picture shown, as shares cut from each side */ crop?: [number, number, number, number]; rotation?: number; alpha?: number; flipH?: boolean; flipV?: boolean; /** a picture cut to a shape (an ellipse, a rounded box) */ geometry?: string; adjust?: Record<string, number>; xform?: Xform }

export type SlideLine = { kind: 'line'; x0: number; y0: number; x1: number; y1: number; color: string; width: number; dash?: 'dash' | 'dot' | 'dashDot'; alpha?: number; head?: LineEnd; tail?: LineEnd; xform?: Xform }

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

export type SlideTable = { kind: 'table'; x: number; y: number; w: number; h: number; colWidths: number[]; rowHeights: number[]; cells: SlideTableCell[][]; xform?: Xform }

/** something in the file that is not drawn (a chart, a diagram): a place holder so the gap is visible */
export type SlideUnsupported = { kind: 'unsupported'; x: number; y: number; w: number; h: number; what: string; xform?: Xform }

/** a chart, read from the values the file keeps with it (reading only) */
export type SlideChart = { kind: 'chart'; x: number; y: number; w: number; h: number; chart: Chart; xform?: Xform }

export type SlideShape = SlideBox | SlidePicture | SlideLine | SlideTable | SlideChart | SlideUnsupported

export type Slide = { /** a plain colour (writing) */ background?: string; /** any background (reading) */ backgroundPaint?: Paint; shapes: SlideShape[]; hidden?: boolean }

export type Deck = { width: number; height: number; slides: Slide[]; title?: string }
