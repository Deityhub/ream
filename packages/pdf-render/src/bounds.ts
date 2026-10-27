// Finding out where each drawing instruction of a page paints, without painting anything, and cutting out the
// instructions that fall entirely outside a given box. The renderer's own interpreter does the geometry (matrices,
// fonts, text advance); a recording stand-in for the canvas collects the bounds.
import { PdfStream, decodeStream, isDict, isName, scanContent, usedResources, type PdfDict, type PdfDocument, type UsedResources } from '@ream/pdf-core'
import { Interpreter, type OpInfo } from './interpreter.ts'
import { IDENTITY, apply, mul, scaleOf, type Matrix } from './matrix.ts'
import type { Ctx2D, Platform } from './platform.ts'

/** [x1, y1, x2, y2] in page user space, x1 <= x2 and y1 <= y2 */
export type Box = [number, number, number, number]

const HUGE = 1e7

/**
 * A 2D context that draws nothing and remembers the bounds of what would have been painted, in the coordinates the
 * interpreter works in. Bounds are deliberately generous (curve control points, stroke widths, whole text em boxes):
 * a box that is too big only means something near an edge is kept.
 */
export class BoundsCtx {
  private m: Matrix = IDENTITY
  private stack: { m: Matrix; lineWidth: number; miterLimit: number; fontPx: number }[] = []
  private path: [number, number][] = []
  private bounds: Box | null = null
  lineWidth = 1
  miterLimit = 10
  fontPx = 10

  // everything the interpreter sets or calls that doesn't change where things go is accepted and ignored (see the proxy)
  constructor() {
    return new Proxy(this, {
      get: (t, k: string) => (k in t ? (t as unknown as Record<string, unknown>)[k] : () => ({ addColorStop() {} })),
      set: (t, k: string, v) => {
        ;(t as unknown as Record<string, unknown>)[k] = v
        if (k === 'font') {
          const px = /([\d.]+)px/.exec(String(v))
          if (px) t.fontPx = Number(px[1])
        }
        return true
      },
    })
  }

  /** bounds of what was painted since the last call (null when nothing was) */
  take(): Box | null {
    const b = this.bounds
    this.bounds = null
    return b
  }

  private add(points: [number, number][], pad = 0) {
    for (const [x, y] of points) {
      const b = (this.bounds ??= [x, y, x, y])
      b[0] = Math.min(b[0], x - pad)
      b[1] = Math.min(b[1], y - pad)
      b[2] = Math.max(b[2], x + pad)
      b[3] = Math.max(b[3], y + pad)
    }
  }
  private corners(x: number, y: number, w: number, h: number): [number, number][] {
    return [apply(this.m, x, y), apply(this.m, x + w, y), apply(this.m, x, y + h), apply(this.m, x + w, y + h)]
  }

  save() {
    this.stack.push({ m: this.m, lineWidth: this.lineWidth, miterLimit: this.miterLimit, fontPx: this.fontPx })
  }
  restore() {
    const s = this.stack.pop()
    if (s) ({ m: this.m, lineWidth: this.lineWidth, miterLimit: this.miterLimit, fontPx: this.fontPx } = s)
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.m = [a, b, c, d, e, f]
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.m = mul([a, b, c, d, e, f], this.m)
  }
  beginPath() {
    this.path = []
  }
  closePath() {}
  moveTo(x: number, y: number) {
    this.path.push(apply(this.m, x, y))
  }
  lineTo(x: number, y: number) {
    this.path.push(apply(this.m, x, y))
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
    this.path.push(apply(this.m, x1, y1), apply(this.m, x2, y2), apply(this.m, x, y))
  }
  rect(x: number, y: number, w: number, h: number) {
    this.path.push(...this.corners(x, y, w, h))
  }
  fill() {
    this.add(this.path)
  }
  stroke() {
    // half the line width on each side, more at mitred corners
    this.add(this.path, (this.lineWidth * scaleOf(this.m) * Math.max(1, this.miterLimit)) / 2)
  }
  clip() {}
  fillRect(x: number, y: number, w: number, h: number) {
    this.add(this.corners(x, y, w, h))
  }
  private text(text: string, x: number, y: number) {
    const w = text.length * this.fontPx
    this.add(this.corners(x, y - this.fontPx * 1.1, w, this.fontPx * 1.5))
  }
  fillText(text: string, x: number, y: number) {
    this.text(text, x, y)
  }
  strokeText(text: string, x: number, y: number) {
    this.text(text, x, y)
  }
  drawImage(_image: unknown, x = 0, y = 0) {
    this.add(this.corners(x, y, 1, 1))
  }
  measureText(text: string) {
    return { width: text.length * this.fontPx }
  }
  setLineDash() {}
}

export type PaintedOp = OpInfo & { bbox: Box | null }

const NO_PLATFORM: Platform = {
  imageFromRGBA: () => ({}) as CanvasImageSource,
  decodeJpeg: () => Promise.reject(new Error('not needed: pictures are not decoded for analysis')),
}

/** the page's content streams joined into one buffer, the way the renderer reads them */
export async function pageContent(doc: PdfDocument, index: number): Promise<{ content: Uint8Array; res: PdfDict }> {
  const page = doc.pages()[index]
  const parts: Uint8Array[] = []
  for (const c of [doc.resolve(page.dict.get('Contents'))].flat().map((x) => doc.resolve(x))) {
    if (c instanceof PdfStream) parts.push(await decodeStream(c).catch(() => new Uint8Array(0)))
  }
  const content = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0))
  parts.reduce((at, p) => (content.set(p, at), (content[at + p.length] = 10), at + p.length + 1), 0)
  const res = doc.resolve(page.dict.get('Resources') ?? page.inherited.get('Resources'))
  return { content, res: isDict(res) ? res : new Map() }
}

/** every operator of the page's own content with the bounds of what it paints, in page user space */
export async function analyzePage(doc: PdfDocument, index: number): Promise<{ content: Uint8Array; ops: PaintedOp[] }> {
  const { content, res } = await pageContent(doc, index)
  const ctx = new BoundsCtx()
  const interp = new Interpreter(doc, ctx as unknown as Ctx2D, NO_PLATFORM, IDENTITY)
  interp.analysis = true
  const ops: PaintedOp[] = []
  interp.onOp = (info) => ops.push({ ...info, bbox: ctx.take() })
  await interp.run(content, res, true)
  return { content, ops }
}

const POSITIONING = new Set(['Td', 'TD', 'Tm', 'T*', "'", '"', 'BT', 'ET'])
const PATH_PAINT = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'S', 's'])
const outside = (b: Box, keep: Box, pad: number) => b[2] < keep[0] - pad || b[0] > keep[2] + pad || b[3] < keep[1] - pad || b[1] > keep[3] + pad
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))

/** the number a TJ array needs to move the text position exactly as the removed string did, or null if that can't be told */
function advanceAdjust(o: OpInfo): number | null {
  const [a, b, c, d, e, f] = o.tmBefore
  const [a2, b2, c2, d2, e2, f2] = o.tmAfter
  if (![a, b, c, d].every((v, i) => same(v, [a2, b2, c2, d2][i]))) return null // the operator did more than move along the line
  const scale = o.fontSize * o.hScale
  if (!scale) return null
  const tx = Math.abs(a) > 1e-9 ? (e2 - e) / a : Math.abs(b) > 1e-9 ? (f2 - f) / b : null
  if (tx === null || !Number.isFinite(tx)) return null
  // the move must be along the text line: both coordinates agree with tx
  if (!same(e2 - e, tx * a) || !same(f2 - f, tx * b)) return null
  return (-tx * 1000) / scale
}

export type Removal = {
  content: Uint8Array
  /** how many operators were cut or reduced to a plain move along the line */
  removed: number
  /** the resources the remaining content names; null means "keep all of them" (something relies on inherited resources) */
  used: UsedResources | null
}

/**
 * The page's content without the drawing instructions that lie entirely outside `keep` (page user space). Anything
 * that touches `keep`, can't be placed, or whose removal might change what stays visible is kept untouched:
 * path paints become `n` (their clip survives), pictures, shadings and inline images are cut, text strings become a
 * move of the same length so the text after them doesn't shift.
 */
export async function removeOutside(doc: PdfDocument, index: number, keep: Box, pad = 1): Promise<Removal> {
  const { content, ops } = await analyzePage(doc, index)
  const edits: { start: number; end: number; text: string }[] = []
  // a shown string moves the text position along the line, but Td, TD, T*, Tm and the like start from the line's own
  // start, not from where the last string ended: so the length of a removed string only matters when another string follows directly
  const advanceMatters = (i: number) => {
    for (let j = i + 1; j < ops.length; j++) {
      if (ops[j].op === 'Tj' || ops[j].op === 'TJ') return true
      if (POSITIONING.has(ops[j].op)) return false
    }
    return false
  }
  ops.forEach((o, i) => {
    if (!o.bbox || !outside(o.bbox, keep, pad)) return
    const cut = (text: string) => edits.push({ start: o.start, end: o.end, text })
    if (PATH_PAINT.has(o.op)) cut('n')
    else if (o.op === 'Do' || o.op === 'sh' || o.op === 'BI') cut('')
    else if ((o.op === 'Tj' || o.op === 'TJ' || o.op === "'" || o.op === '"') && o.renderMode < 4) {
      // what to leave in place of the string: whatever of the operator moved the position, then (if needed) a move as long as the string was
      const lead = o.op === "'" ? 'T*' : o.op === '"' ? `${Number(o.args[0]) || 0} Tw ${Number(o.args[1]) || 0} Tc T*` : ''
      if (!advanceMatters(i)) return cut(lead)
      const n = o.unknownWidth || o.op === "'" || o.op === '"' ? null : advanceAdjust(o)
      if (n !== null) cut(`[${+n.toFixed(4)}] TJ`)
    }
  })
  const parts: Uint8Array[] = []
  const enc = new TextEncoder()
  let at = 0
  for (const e of edits) {
    parts.push(content.subarray(at, e.start), enc.encode(e.text + ' '))
    at = e.end
  }
  parts.push(content.subarray(at))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((i, p) => (out.set(p, i), i + p.length), 0)

  const kept = scanContent(out)
  const used = usedResources(kept)
  // a form without resources of its own draws with the page's, so what it needs is unknown: keep every resource
  let inherits = false
  const page = doc.pages()[index]
  const res = doc.resolve(page.dict.get('Resources') ?? page.inherited.get('Resources'))
  const xobjects = isDict(res) ? doc.resolve(res.get('XObject')) : null
  for (const name of used.names.XObject ?? []) {
    const x = isDict(xobjects) ? doc.resolve(xobjects.get(name)) : null
    if (x instanceof PdfStream && !x.dict.has('Resources') && isName(doc.resolve(x.dict.get('Subtype')), 'Form')) inherits = true
  }
  return { content: out, removed: edits.length, used: inherits ? null : used }
}

/** how big each picture is painted, in points: the largest size over all the places it is used */
export type Placement = { width: number; height: number }

export async function imagePlacements(doc: PdfDocument): Promise<Map<PdfStream, Placement>> {
  const out = new Map<PdfStream, Placement>()
  for (let i = 0; i < doc.pages().length; i++) {
    const { content, res } = await pageContent(doc, i)
    const interp = new Interpreter(doc, new BoundsCtx() as unknown as Ctx2D, NO_PLATFORM, IDENTITY)
    interp.analysis = true
    interp.onImage = (image, m) => {
      // the picture fills the unit square, so the lengths of the transformed sides are its size
      const w = Math.hypot(m[0], m[1])
      const h = Math.hypot(m[2], m[3])
      const seen = out.get(image)
      out.set(image, { width: Math.max(seen?.width ?? 0, w), height: Math.max(seen?.height ?? 0, h) })
    }
    try {
      await interp.run(content, res)
    } catch {
      // a page that can't be read just contributes nothing: its pictures are left as they are
    }
  }
  return out
}
