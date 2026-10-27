// A slide drawn onto a PDF page: background, then each shape in order. Shapes keep the places, outlines, fills (colours,
// gradients, pictures), lines and turns the file gives them; text is laid out again in the faces the font book found, so a
// line can break a little differently from PowerPoint's.
import { PageDraw, PdfDrawing, type Gradient, type Rgb, type Seg } from '@ream/pdf-core'
import type { CustomPath, LineEnd, Paint, Slide, SlideBox, SlideLine, SlidePicture, SlideShape, SlideTable, Stroke } from '@ream/office-core'
import type { FontBook } from '../fonts/book.ts'
import { drawChart } from '../office-charts.ts'
import { hexRgb } from '../office-fonts.ts'
import { geometryPath, type Outline } from './geometry.ts'
import { drawText, layoutText, textHeight } from './text.ts'

/** the number a picture was registered under in the drawing, or null when it cannot be shown */
export type ImageFor = (p: { bytes: Uint8Array; type: SlidePicture['type']; name?: string }) => number | null
type Env = { book: FontBook; imageFor: ImageFor }

const GREY: Rgb = [150, 150, 150]
const dashes = (d: Stroke['dash'], w: number): number[] | undefined => {
  const u = Math.max(w, 0.75)
  return d === 'dash' ? [4 * u, 3 * u] : d === 'dot' ? [u, 2 * u] : d === 'dashDot' ? [4 * u, 2 * u, u, 2 * u] : undefined
}

/** a custom outline's paths placed in the box */
function customOutline(paths: CustomPath[], x: number, y: number, w: number, h: number): { fill: Seg[]; stroke: Seg[] } {
  const fill: Seg[] = []
  const stroke: Seg[] = []
  for (const p of paths) {
    const [kx, ky] = [w / p.w, h / p.h]
    const segs = p.segs.map((s): Seg => (s[0] === 'Z' ? ['Z'] : s[0] === 'C' ? ['C', x + s[1] * kx, y + s[2] * ky, x + s[3] * kx, y + s[4] * ky, x + s[5] * kx, y + s[6] * ky] : [s[0], x + s[1] * kx, y + s[2] * ky]))
    if (p.fill) fill.push(...segs)
    if (p.stroke) stroke.push(...segs)
  }
  return { fill, stroke }
}

const gradientOf = (p: Extract<Paint, { type: 'gradient' }>): Gradient =>
  p.center ? { type: 'radial', stops: p.stops.map((s) => ({ at: s.at, color: hexRgb(s.color) })), cx: p.center[0], cy: p.center[1] } : { type: 'linear', stops: p.stops.map((s) => ({ at: s.at, color: hexRgb(s.color) })), angle: p.angle ?? 0 }
/** a gradient's see-through is drawn as the average of its stops' (ponytail: no per-stop opacity) */
const gradientAlpha = (p: Extract<Paint, { type: 'gradient' }>) => {
  const a = p.stops.reduce((n, s) => n + (s.alpha ?? 1), 0) / p.stops.length
  return a < 1 ? a : undefined
}

/** a picture stretched over a box, with its crop (shares cut from each side, negative to add room) */
function drawPictureIn(page: PageDraw, id: number, x: number, y: number, w: number, h: number, crop?: number[], alpha?: number) {
  const [l, t, r, b] = crop ?? [0, 0, 0, 0]
  const fw = w / Math.max(0.01, 1 - l - r)
  const fh = h / Math.max(0.01, 1 - t - b)
  page.image(id, x - l * fw, y - t * fh, fw, fh, alpha)
}

/** fill an outline with a paint */
function fillWith(page: PageDraw, segs: Seg[], paint: Paint, box: { x: number; y: number; w: number; h: number }, env: Env, evenOdd?: boolean) {
  if (!segs.length) return
  if (paint.type === 'solid') page.path(segs, { fill: hexRgb(paint.color), fillAlpha: paint.alpha, evenOdd })
  else if (paint.type === 'gradient') page.path(segs, { fill: gradientOf(paint), fillAlpha: gradientAlpha(paint), evenOdd })
  else {
    const id = env.imageFor({ bytes: paint.bytes, type: paint.kind, name: paint.name })
    if (id === null) return
    page.save()
    page.clipPath(segs, evenOdd)
    drawPictureIn(page, id, box.x, box.y, box.w, box.h, paint.crop, paint.alpha)
    page.restore()
  }
}

/** an arrowhead (or other end) at (x1, y1) for a line coming from (x0, y0) */
function lineEnd(page: PageDraw, end: LineEnd, x0: number, y0: number, x1: number, y1: number, w: number, color: Rgb, alpha?: number) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1
  const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len]
  const s = Math.max(w * 3, 4)
  const [bx, by] = [x1 - ux * s, y1 - uy * s]
  const [px, py] = [-uy * s * 0.5, ux * s * 0.5]
  const fill = { fill: color, fillAlpha: alpha }
  if (end === 'triangle') page.path([['M', x1, y1], ['L', bx + px, by + py], ['L', bx - px, by - py], ['Z']], fill)
  else if (end === 'stealth') page.path([['M', x1, y1], ['L', bx + px, by + py], ['L', x1 - ux * s * 0.6, y1 - uy * s * 0.6], ['L', bx - px, by - py], ['Z']], fill)
  else if (end === 'arrow') page.path([['M', bx + px, by + py], ['L', x1, y1], ['L', bx - px, by - py]], { stroke: color, width: w, strokeAlpha: alpha })
  else if (end === 'diamond') page.path([['M', x1 + ux * s * 0.5, y1 + uy * s * 0.5], ['L', x1 + px, y1 + py], ['L', x1 - ux * s * 0.5, y1 - uy * s * 0.5], ['L', x1 - px, y1 - py], ['Z']], fill)
  else {
    const r = s * 0.4
    const k = 0.5523 * r
    page.path([['M', x1 + r, y1], ['C', x1 + r, y1 + k, x1 + k, y1 + r, x1, y1 + r], ['C', x1 - k, y1 + r, x1 - r, y1 + k, x1 - r, y1], ['C', x1 - r, y1 - k, x1 - k, y1 - r, x1, y1 - r], ['C', x1 + k, y1 - r, x1 + r, y1 - k, x1 + r, y1], ['Z']], fill)
  }
}

/** the first and last direction of an open outline, for its line ends */
function ends(segs: Seg[]): [[number, number, number, number], [number, number, number, number]] | null {
  const pts = segs.flatMap((s): [number, number][] => (s[0] === 'Z' ? [] : s[0] === 'C' ? [[s[1], s[2]], [s[3], s[4]], [s[5], s[6]]] : [[s[1], s[2]]]))
  if (pts.length < 2) return null
  const [a, b] = [pts[0], pts.find((p) => p[0] !== pts[0][0] || p[1] !== pts[0][1]) ?? pts[1]]
  const z = pts[pts.length - 1]
  const y = [...pts].reverse().find((p) => p[0] !== z[0] || p[1] !== z[1]) ?? pts[pts.length - 2]
  return [[b[0], b[1], a[0], a[1]], [y[0], y[1], z[0], z[1]]]
}

/** turn, mirror or transform what follows, as the shape asks; returns whether a `restore` is due */
function place(page: PageDraw, s: { x: number; y: number; w: number; h: number; rotation?: number; flipH?: boolean; flipV?: boolean; xform?: number[] }): boolean {
  if (!s.rotation && !s.flipH && !s.flipV && !s.xform) return false
  page.save()
  if (s.xform) page.transform(s.xform[0], s.xform[1], s.xform[2], s.xform[3], s.xform[4], s.xform[5])
  const [cx, cy] = [s.x + s.w / 2, s.y + s.h / 2]
  if (s.rotation) page.rotate(s.rotation, cx, cy)
  if (s.flipH || s.flipV) page.flip(!!s.flipH, !!s.flipV, cx, cy)
  return true
}

function drawBox(page: PageDraw, b: SlideBox, env: Env) {
  const placed = place(page, b)
  const paint = b.paint ?? (b.fill ? { type: 'solid' as const, color: b.fill } : undefined)
  let outline: Outline
  let strokeSegs: Seg[]
  if (b.paths?.length) {
    const c = customOutline(b.paths, b.x, b.y, b.w, b.h)
    outline = { segs: c.fill }
    strokeSegs = c.stroke
  } else {
    outline = geometryPath(b.geometry ?? 'rect', b.x, b.y, b.w, b.h, b.adjust)
    strokeSegs = outline.segs
  }
  if (paint && !outline.open) fillWith(page, outline.segs, paint, b, env, outline.evenOdd)
  if (b.line && b.line.width > 0) {
    const color = hexRgb(b.line.color)
    page.path(strokeSegs, { stroke: color, width: b.line.width, strokeAlpha: b.line.alpha, dash: dashes(b.line.dash, b.line.width) })
    const e = outline.open ? ends(strokeSegs) : null
    if (e && b.line.head) lineEnd(page, b.line.head, ...e[0], b.line.width, color, b.line.alpha)
    if (e && b.line.tail) lineEnd(page, b.line.tail, ...e[1], b.line.width, color, b.line.alpha)
  }
  // text keeps its box when the shape is mirrored (PowerPoint never mirrors letters): undo the flip for it
  if (b.paragraphs.length) {
    const [l, t, r, bt] = b.insets ?? [0, 0, 0, 0]
    let area = { x: b.x + l, y: b.y + t, w: Math.max(1, b.w - l - r), h: Math.max(1, b.h - t - bt) }
    const unflip = placed && (b.flipH || b.flipV)
    if (unflip) {
      page.save()
      page.flip(!!b.flipH, !!b.flipV, b.x + b.w / 2, b.y + b.h / 2)
    }
    if (b.vertical) {
      // text running down the box: lay it out in a box turned a quarter
      const [cx, cy] = [area.x + area.w / 2, area.y + area.h / 2]
      page.save()
      page.rotate(b.vertical === 'vert' ? 90 : -90, cx, cy)
      area = { x: cx - area.h / 2, y: cy - area.w / 2, w: area.h, h: area.w }
    }
    drawText(page, layoutText(b.paragraphs, area.w, b.wrap !== false, b.lineReduction ?? 0, env.book), area, b.anchor ?? 'top')
    if (b.vertical) page.restore()
    if (unflip) page.restore()
  }
  if (placed) page.restore()
}

function drawLine(page: PageDraw, l: SlideLine) {
  const placed = place(page, { x: 0, y: 0, w: 0, h: 0, xform: l.xform })
  const color = hexRgb(l.color)
  page.line(l.x0, l.y0, l.x1, l.y1, l.width, color, dashes(l.dash, l.width), l.alpha)
  if (l.head) lineEnd(page, l.head, l.x1, l.y1, l.x0, l.y0, l.width, color, l.alpha)
  if (l.tail) lineEnd(page, l.tail, l.x0, l.y0, l.x1, l.y1, l.width, color, l.alpha)
  if (placed) page.restore()
}

function drawPicture(page: PageDraw, p: SlidePicture, env: Env) {
  const id = env.imageFor(p)
  const placed = place(page, p)
  if (id === null) page.fillRect(p.x, p.y, p.w, p.h, [235, 235, 235])
  else {
    page.save()
    // a picture cut to a shape (an oval photo); a cropped one is cut to its frame
    if (p.geometry) page.clipPath(geometryPath(p.geometry, p.x, p.y, p.w, p.h, p.adjust).segs)
    else if (p.crop) page.clip(p.x, p.y, p.w, p.h)
    drawPictureIn(page, id, p.x, p.y, p.w, p.h, p.crop, p.alpha)
    page.restore()
  }
  if (placed) page.restore()
}

function drawTable(page: PageDraw, t: SlideTable, env: Env) {
  const placed = place(page, t)
  const cols = t.colWidths.length
  const insetOf = (c: SlideTable['cells'][number][number]) => c.insets ?? [7.2, 3.6, 7.2, 3.6]
  const spanW = (c: number, n: number) => t.colWidths.slice(c, c + n).reduce((a, b) => a + b, 0)
  // a row is as tall as the file says or as its text needs, whichever is more
  const heights = t.rowHeights.map((h) => h)
  t.cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell.covered || (cell.rows ?? 1) > 1) return
      const [l, tp, rr, bt] = insetOf(cell)
      const w = spanW(c, cell.cols ?? 1) - l - rr
      heights[r] = Math.max(heights[r] ?? 0, textHeight(layoutText(cell.paragraphs, Math.max(1, w), true, 0, env.book)) + tp + bt)
    })
  })
  const ys = [t.y]
  heights.forEach((h, i) => ys.push(ys[i] + h))
  const xs = [t.x]
  t.colWidths.forEach((w, i) => xs.push(xs[i] + w))
  // fills first, then text, then lines, so a line is never hidden by a neighbour's fill
  const anchors: { cell: SlideTable['cells'][number][number]; x0: number; y0: number; x1: number; y1: number }[] = []
  t.cells.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.covered) return
    anchors.push({ cell, x0: xs[c], y0: ys[r], x1: xs[Math.min(cols, c + (cell.cols ?? 1))], y1: ys[Math.min(heights.length, r + (cell.rows ?? 1))] })
  }))
  for (const a of anchors) if (a.cell.fill) page.fillRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0, hexRgb(a.cell.fill))
  for (const a of anchors) {
    const [l, tp, rr, bt] = insetOf(a.cell)
    const area = { x: a.x0 + l, y: a.y0 + tp, w: Math.max(1, a.x1 - a.x0 - l - rr), h: Math.max(1, a.y1 - a.y0 - tp - bt) }
    drawText(page, layoutText(a.cell.paragraphs, area.w, true, 0, env.book), area, a.cell.anchor ?? 'top')
  }
  for (const a of anchors) {
    const e = a.cell.edges
    const edge = (k: 'l' | 'r' | 't' | 'b', x0: number, y0: number, x1: number, y1: number) => {
      const v = e?.[k] ?? (a.cell.border ? { color: '000000', width: 0.5 } : undefined)
      if (v) page.line(x0, y0, x1, y1, Math.max(0.25, v.width), hexRgb(v.color))
    }
    edge('t', a.x0, a.y0, a.x1, a.y0)
    edge('b', a.x0, a.y1, a.x1, a.y1)
    edge('l', a.x0, a.y0, a.x0, a.y1)
    edge('r', a.x1, a.y0, a.x1, a.y1)
  }
  if (placed) page.restore()
}

function drawShape(page: PageDraw, sh: SlideShape, env: Env) {
  if (sh.kind === 'text') drawBox(page, sh, env)
  else if (sh.kind === 'line') drawLine(page, sh)
  else if (sh.kind === 'pic') drawPicture(page, sh, env)
  else if (sh.kind === 'table') drawTable(page, sh, env)
  else {
    const placed = place(page, sh)
    if (sh.kind === 'chart') drawChart(page, sh.chart, sh, env.book)
    else {
      page.path([['M', sh.x, sh.y], ['L', sh.x + sh.w, sh.y], ['L', sh.x + sh.w, sh.y + sh.h], ['L', sh.x, sh.y + sh.h], ['Z']], { stroke: GREY, width: 0.75, dash: [4, 3] })
      drawText(page, layoutText([{ runs: [{ text: `${sh.what} (not shown)`, size: 11, color: '808080', font: 'Arial' }], align: 'center' }], sh.w, true, 0, env.book), { x: sh.x, y: sh.y, w: sh.w, h: sh.h }, 'middle')
    }
    if (placed) page.restore()
  }
}

/** one slide as a page of the drawing */
export function drawSlide(d: PdfDrawing, slide: Slide, size: { width: number; height: number }, env: Env): void {
  const page = d.addPage(size.width, size.height)
  const full: Seg[] = [['M', 0, 0], ['L', size.width, 0], ['L', size.width, size.height], ['L', 0, size.height], ['Z']]
  const bg = slide.backgroundPaint ?? (slide.background ? { type: 'solid' as const, color: slide.background } : undefined)
  if (bg) fillWith(page, full, bg, { x: 0, y: 0, w: size.width, h: size.height }, env)
  for (const sh of slide.shapes) drawShape(page, sh, env)
}
