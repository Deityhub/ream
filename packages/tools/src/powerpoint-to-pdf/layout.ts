// A slide drawn onto a PDF page: background, then each shape in order. Shapes keep the places the file gives them; text is
// laid out again with the standard fonts, so a line can break differently from PowerPoint's.
import { PageDraw, PdfDrawing, type PreparedFont, type Rgb } from '@ream/pdf-core'
import type { Slide, SlideBox, SlideLine, SlidePicture, SlideTable } from '@ream/office-core'
import { hexRgb } from '../office-fonts.ts'
import { geometryPath } from './geometry.ts'
import { drawText, layoutText, textHeight } from './text.ts'

/** the number a picture was registered under in the drawing, or null when it cannot be shown */
export type ImageFor = (p: { bytes: Uint8Array; type: SlidePicture['type']; name?: string }) => number | null

type Env = { emb: PreparedFont | null; imageFor: ImageFor }

const GREY: Rgb = [150, 150, 150]
const dashes = (d: 'dash' | 'dot' | 'dashDot' | undefined, w: number): number[] | undefined => {
  const u = Math.max(w, 0.75)
  return d === 'dash' ? [4 * u, 3 * u] : d === 'dot' ? [u, 2 * u] : d === 'dashDot' ? [4 * u, 2 * u, u, 2 * u] : undefined
}

function drawBox(page: PageDraw, b: SlideBox, env: Env) {
  const turned = !!b.rotation
  if (turned) {
    page.save()
    page.rotate(b.rotation!, b.x + b.w / 2, b.y + b.h / 2)
  }
  if (b.fill || b.line) {
    page.path(geometryPath(b.geometry ?? 'rect', b.x, b.y, b.w, b.h), {
      fill: b.fill ? hexRgb(b.fill) : undefined,
      fillAlpha: b.fillAlpha,
      stroke: b.line ? hexRgb(b.line.color) : undefined,
      width: b.line?.width,
      dash: dashes(b.line?.dash, b.line?.width ?? 1),
    })
  }
  if (b.paragraphs.length) {
    const [l, t, r, bt] = b.insets ?? [0, 0, 0, 0]
    const area = { x: b.x + l, y: b.y + t, w: Math.max(1, b.w - l - r), h: Math.max(1, b.h - t - bt) }
    drawText(page, layoutText(b.paragraphs, area.w, b.wrap !== false, b.lineReduction ?? 0, env.emb), area, b.anchor ?? 'top', env.emb)
  }
  if (turned) page.restore()
}

function drawLine(page: PageDraw, l: SlideLine) {
  page.line(l.x0, l.y0, l.x1, l.y1, l.width, hexRgb(l.color), dashes(l.dash, l.width))
}

function drawPicture(page: PageDraw, p: SlidePicture, env: Env) {
  const id = env.imageFor(p)
  if (id === null) {
    page.fillRect(p.x, p.y, p.w, p.h, [235, 235, 235])
    return
  }
  page.save()
  if (p.rotation) page.rotate(p.rotation, p.x + p.w / 2, p.y + p.h / 2)
  const [l, t, r, b] = p.crop ?? [0, 0, 0, 0]
  const fw = p.w / Math.max(0.01, 1 - l - r)
  const fh = p.h / Math.max(0.01, 1 - t - b)
  if (p.crop) page.clip(p.x, p.y, p.w, p.h)
  page.image(id, p.x - l * fw, p.y - t * fh, fw, fh)
  page.restore()
}

function drawTable(page: PageDraw, t: SlideTable, env: Env) {
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
      heights[r] = Math.max(heights[r] ?? 0, textHeight(layoutText(cell.paragraphs, Math.max(1, w), true, 0, env.emb)) + tp + bt)
    })
  })
  const ys = [t.y]
  heights.forEach((h, i) => ys.push(ys[i] + h))
  const xs = [t.x]
  t.colWidths.forEach((w, i) => xs.push(xs[i] + w))
  // fills first, then text, then lines, so a line is never hidden by a neighbour's fill
  const anchors: { r: number; c: number; cell: SlideTable['cells'][number][number]; x0: number; y0: number; x1: number; y1: number }[] = []
  t.cells.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.covered) return
    anchors.push({ r, c, cell, x0: xs[c], y0: ys[r], x1: xs[Math.min(cols, c + (cell.cols ?? 1))], y1: ys[Math.min(heights.length, r + (cell.rows ?? 1))] })
  }))
  for (const a of anchors) if (a.cell.fill) page.fillRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0, hexRgb(a.cell.fill))
  for (const a of anchors) {
    const [l, tp, rr, bt] = insetOf(a.cell)
    const area = { x: a.x0 + l, y: a.y0 + tp, w: Math.max(1, a.x1 - a.x0 - l - rr), h: Math.max(1, a.y1 - a.y0 - tp - bt) }
    drawText(page, layoutText(a.cell.paragraphs, area.w, true, 0, env.emb), area, a.cell.anchor ?? 'top', env.emb)
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
}

/** one slide as a page of the drawing */
export function drawSlide(d: PdfDrawing, slide: Slide, size: { width: number; height: number }, env: Env): void {
  const page = d.addPage(size.width, size.height)
  if (slide.background) page.fillRect(0, 0, size.width, size.height, hexRgb(slide.background, [255, 255, 255]))
  if (slide.backgroundPicture) {
    const id = env.imageFor(slide.backgroundPicture)
    if (id !== null) page.image(id, 0, 0, size.width, size.height)
  }
  for (const sh of slide.shapes) {
    if (sh.kind === 'text') drawBox(page, sh, env)
    else if (sh.kind === 'line') drawLine(page, sh)
    else if (sh.kind === 'pic') drawPicture(page, sh, env)
    else if (sh.kind === 'table') drawTable(page, sh, env)
    else {
      page.path([['M', sh.x, sh.y], ['L', sh.x + sh.w, sh.y], ['L', sh.x + sh.w, sh.y + sh.h], ['L', sh.x, sh.y + sh.h], ['Z']], { stroke: GREY, width: 0.75, dash: [4, 3] })
      drawText(page, layoutText([{ runs: [{ text: `${sh.what} (not shown)`, size: 11, color: '808080', font: 'Arial' }], align: 'center' }], sh.w, true, 0, env.emb), { x: sh.x, y: sh.y, w: sh.w, h: sh.h }, 'middle', env.emb)
    }
  }
}
