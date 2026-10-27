// Items to what `decorate` takes: one drawing page per page that gets something drawn (text, pictures, shapes,
// drawings, whiteout), and annotations for markup, notes and links.
import { UserError } from '@ream/core'
import { PdfDocument, PdfDrawing, buildPdf, jpegInfo, measure, type Annotation, type FontSpec, type PageAdditions, type PageDraw, type PathStyle, type Quad, type Rgb, type Seg } from '@ream/pdf-core'
import { decodePng } from '@ream/image-core'
import { FontBook, type FontSource } from '../fonts/book.ts'
import { wrapLines } from './layout.ts'
import { colourOf, itemsOn, lineBox, type EditPdfOptions, type Item, type Point, type TextItem } from './items.ts'

type Size = { width: number; height: number }

const rgb = (hex: string): Rgb => colourOf(hex).map((v) => Math.round(v * 255)) as Rgb
const ELLIPSE = 0.5523 // control point distance of a quarter circle drawn with one Bézier

/** what each page gets, keyed by page index */
export async function additions(doc: PdfDocument, o: EditPdfOptions, source: FontSource): Promise<Map<number, PageAdditions>> {
  const sizes: Size[] = doc.pages().map((p) => doc.pageSize(p))
  const book = new FontBook(source, o.fonts)
  await book.load(o.items.filter((i): i is TextItem => i.kind === 'text').map((t) => ({ name: t.font, bold: t.bold, italic: t.italic, text: t.text })))

  const drawing = new PdfDrawing()
  const drawn = new Map<number, number>() // page index -> drawing page
  const out = new Map<number, PageAdditions>()
  // each picture once, however many pages show it
  const images = new Map<Uint8Array, number>()
  for (const i of o.items) if (i.kind === 'image' && !images.has(i.data)) images.set(i.data, drawing.addImage(await picture(i.data, i.type)))
  sizes.forEach((size, index) => {
    const items = itemsOn(o.items, index)
    const marks = items.filter((i) => i.kind !== 'markup' && i.kind !== 'note' && i.kind !== 'link')
    if (marks.length) {
      drawn.set(index, drawing.pages.length)
      const page = drawing.addPage(size.width, size.height)
      for (const item of marks) draw(page, item, size, book, (data) => images.get(data)!)
    }
    const annots = items.flatMap((i) => annotation(i, size))
    if (annots.length) out.set(index, { annots })
  })

  if (drawing.pages.length) {
    const { bytes, lost } = await buildPdf(drawing)
    if (lost.length) throw new UserError(`The font chosen for some text doesn't have ${lost.join(' ')}. Choose another font, or add a font file that has these letters.`)
    const built = await PdfDocument.load(bytes)
    for (const [index, page] of drawn) out.set(index, { ...out.get(index), overlay: { doc: built, page } })
  }
  return out
}

async function picture(data: Uint8Array, type: 'image/png' | 'image/jpeg') {
  if (type === 'image/jpeg') {
    const info = jpegInfo(data)
    if (info) return { jpeg: data, width: info.width, height: info.height, components: info.components, adobe: info.adobe }
  }
  const img = await decodePng(data).catch(() => {
    throw new UserError("A picture added to the PDF can't be read. Add it again.")
  })
  return { rgba: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength), width: img.width, height: img.height }
}

/** one item on its drawing page: points from the top left, as the page is displayed */
function draw(page: PageDraw, item: Item, size: Size, book: FontBook, image: (data: Uint8Array) => number) {
  const X = (v: number) => v * size.width
  const Y = (v: number) => v * size.height
  if (item.kind === 'text') return drawText(page, item, size, book)
  if (item.kind === 'whiteout') return page.path(rect(X(item.box.x), Y(item.box.y), X(item.box.w), Y(item.box.h)), { fill: rgb(item.colour) })
  if (item.kind === 'image') {
    const [x, y, w, h] = [X(item.box.x), Y(item.box.y), X(item.box.w), Y(item.box.h)]
    const id = image(item.data)
    page.save()
    // a positive angle turns clockwise on the page as displayed (y runs down here)
    if (item.turns) page.rotate(90 * item.turns, x + w / 2, y + h / 2)
    // turned a quarter, the picture is drawn into a box with its sides swapped so it fills the item's box once turned
    const swap = item.turns % 2 === 1
    const [dw, dh] = swap ? [h, w] : [w, h]
    page.image(id, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh, item.opacity)
    page.restore()
    return
  }
  if (item.kind === 'shape') {
    const [x, y, w, h] = [X(item.box.x), Y(item.box.y), X(item.box.w), Y(item.box.h)]
    const style: PathStyle = { fill: item.fill ? rgb(item.fill) : undefined, fillAlpha: item.opacity, stroke: item.stroke ? rgb(item.stroke) : undefined, strokeAlpha: item.opacity, width: item.width }
    // the outline sits inside the box, as the panel draws it
    const inset = item.stroke ? item.width / 2 : 0
    const box: [number, number, number, number] = [x + inset, y + inset, Math.max(0, w - 2 * inset), Math.max(0, h - 2 * inset)]
    return page.path(item.shape === 'rect' ? rect(...box) : ellipse(...box), style)
  }
  if (item.kind === 'line') {
    const a: [number, number] = [X(item.from.x), Y(item.from.y)]
    const b: [number, number] = [X(item.to.x), Y(item.to.y)]
    const head = Math.max(6, item.width * 3.5)
    const c = rgb(item.colour)
    // the line stops where an arrow head starts, so its square end doesn't poke through the point
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const ux = (b[0] - a[0]) / len
    const uy = (b[1] - a[1]) / len
    const end: [number, number] = item.arrow !== 'none' ? [b[0] - ux * head * 0.8, b[1] - uy * head * 0.8] : b
    const start: [number, number] = item.arrow === 'both' ? [a[0] + ux * head * 0.8, a[1] + uy * head * 0.8] : a
    page.path([['M', ...start], ['L', ...end]], { stroke: c, strokeAlpha: item.opacity, width: item.width })
    if (item.arrow !== 'none') page.path(arrowHead(b, a, head), { fill: c, fillAlpha: item.opacity })
    if (item.arrow === 'both') page.path(arrowHead(a, b, head), { fill: c, fillAlpha: item.opacity })
    return
  }
  if (item.kind === 'draw') {
    const style: PathStyle = item.highlighter
      ? { stroke: rgb(item.colour), strokeAlpha: 0.5, width: item.width, blend: 'Multiply', round: true }
      : { stroke: rgb(item.colour), width: item.width, round: true }
    for (const stroke of item.strokes) page.path(smooth(stroke.map((p) => [X(p.x), Y(p.y)])), style)
  }
}

const rect = (x: number, y: number, w: number, h: number): Seg[] => [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]

function ellipse(x: number, y: number, w: number, h: number): Seg[] {
  const [cx, cy, rx, ry] = [x + w / 2, y + h / 2, w / 2, h / 2]
  const [kx, ky] = [rx * ELLIPSE, ry * ELLIPSE]
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ['Z'],
  ]
}

/** a filled triangle with its point at `tip`, pointing away from `from` */
function arrowHead(tip: [number, number], from: [number, number], size: number): Seg[] {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0])
  const side = (s: number): [number, number] => [tip[0] - size * Math.cos(a + s), tip[1] - size * Math.sin(a + s)]
  const [l, r] = [side(0.45), side(-0.45)]
  return [['M', tip[0], tip[1]], ['L', l[0], l[1]], ['L', r[0], r[1]], ['Z']]
}

/** a smooth curve through the points of a freehand stroke (Catmull-Rom as Béziers); one point is a dot */
export function smooth(pts: [number, number][]): Seg[] {
  if (!pts.length) return []
  if (pts.length === 1) return [['M', pts[0][0], pts[0][1]], ['L', pts[0][0] + 0.01, pts[0][1]]]
  const segs: Seg[] = [['M', pts[0][0], pts[0][1]]]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const [p1, p2] = [pts[i], pts[i + 1]]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    segs.push(['C', p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]])
  }
  return segs
}

/** a font's ascent and descent as fractions of the size (what CSS uses to place the baseline) */
function metrics(spec: FontSpec): { ascent: number; descent: number } {
  const t = spec.face?.parts[0]
  return t ? { ascent: t.ascent / t.unitsPerEm, descent: -t.descent / t.unitsPerEm } : { ascent: 0.8, descent: 0.2 }
}

function drawText(page: PageDraw, item: TextItem, size: Size, book: FontBook) {
  const spec = book.spec(item.font, item.bold, item.italic)
  const [x, y, w] = [item.box.x * size.width, item.box.y * size.height, item.box.w * size.width]
  const lines = wrapLines(item.text, w, (s) => measure(s, item.size, spec))
  const { ascent, descent } = metrics(spec)
  const box = lineBox(item.size, item.spacing, ascent, descent)
  const colour = rgb(item.colour)
  lines.forEach((line, i) => {
    const lw = measure(line, item.size, spec)
    const lx = item.align === 'center' ? x + (w - lw) / 2 : item.align === 'right' ? x + w - lw : x
    page.text(lx, y + i * box.height + box.baseline, line, spec, item.size, colour, item.opacity)
  })
}

/** markup, notes and links in displayed points from the bottom left, as `decorate` takes them */
function annotation(item: Item, size: Size): Annotation[] {
  const pt = (p: Point): [number, number] => [p.x * size.width, (1 - p.y) * size.height]
  if (item.kind === 'markup') return [{ kind: item.type, quads: item.quads.map((q) => q.map(pt) as Quad), colour: colourOf(item.colour), text: item.text }]
  if (item.kind === 'note') return [{ kind: 'note', at: pt(item.at), text: item.text, colour: colourOf(item.colour) }]
  if (item.kind === 'link') {
    const [x0, y1] = pt({ x: item.box.x, y: item.box.y })
    const [x1, y0] = pt({ x: item.box.x + item.box.w, y: item.box.y + item.box.h })
    return [{ kind: 'link', rect: [x0, y0, x1, y1], uri: item.url || undefined, page: item.url ? undefined : (item.target ?? undefined) }]
  }
  return []
}
