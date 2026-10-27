// Ruled lines and filled boxes of a page, collected while the interpreter draws against a stand-in canvas. Table detection
// reads them. Only straight, axis-aligned strokes and rectangles count; curves and slanted lines are ignored.
import { IDENTITY, apply, mul, scaleOf, type Matrix } from './matrix.ts'

/** a horizontal or vertical rule as displayed (y down, points): x0 <= x1, y0 <= y1 */
export type Rule = { x0: number; y0: number; x1: number; y1: number; width: number; color: string }
/** a filled box that is more than a hairline */
export type FillBox = { x0: number; y0: number; x1: number; y1: number; color: string }
/** `dots` are small round or square filled marks: list bullets drawn as shapes rather than as a character */
export type Shapes = { rules: Rule[]; fills: FillBox[]; dots: FillBox[] }

const MAX_SHAPES = 100_000
const HAIRLINE = 1.6 // a filled box thinner than this many points is a rule drawn as a rectangle
const SQUARE = 0.35 // slack for "horizontal" and "vertical" after transforms

/** `bent[i]` is true when the segment ending at point i is a curve (only its end point is kept) */
type Sub = { pts: [number, number][]; bent: boolean[]; curved: boolean }

export class ShapeRecorder {
  shapes: Shapes = { rules: [], fills: [], dots: [] }
  lineWidth = 1
  fillStyle = '#000'
  strokeStyle = '#000'
  private m: Matrix = IDENTITY
  private stack: { m: Matrix; lineWidth: number }[] = []
  private subs: Sub[] = []

  save() { this.stack.push({ m: this.m, lineWidth: this.lineWidth }) }
  restore() {
    const s = this.stack.pop()
    if (s) ({ m: this.m, lineWidth: this.lineWidth } = s)
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { this.m = [a, b, c, d, e, f] }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) { this.m = mul([a, b, c, d, e, f], this.m) }
  beginPath() { this.subs = [] }
  moveTo(x: number, y: number) { this.subs.push({ pts: [apply(this.m, x, y)], bent: [false], curved: false }) }
  lineTo(x: number, y: number) {
    const s = this.subs[this.subs.length - 1]
    if (s) { s.pts.push(apply(this.m, x, y)); s.bent.push(false) }
    else this.moveTo(x, y)
  }
  bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number) {
    const s = this.subs[this.subs.length - 1]
    if (s) { s.pts.push(apply(this.m, x, y)); s.bent.push(true); s.curved = true }
  }
  closePath() {
    const s = this.subs[this.subs.length - 1]
    if (s && s.pts.length > 1) { s.pts.push(s.pts[0]); s.bent.push(false) }
  }
  rect(x: number, y: number, w: number, h: number) {
    this.subs.push({ pts: [apply(this.m, x, y), apply(this.m, x + w, y), apply(this.m, x + w, y + h), apply(this.m, x, y + h), apply(this.m, x, y)], bent: [false, false, false, false, false], curved: false })
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.rect(x, y, w, h)
    this.fill()
  }

  private count() { return this.shapes.rules.length + this.shapes.fills.length + this.shapes.dots.length }

  /** the box a subpath covers when it is an axis-aligned rectangle (4 corners, closed), else null */
  private box(s: Sub): [number, number, number, number] | null {
    const p = s.pts
    if (s.curved || p.length < 4 || p.length > 5) return null
    const xs = p.map((q) => q[0])
    const ys = p.map((q) => q[1])
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    // every point sits on a corner
    return p.every((q) => (Math.abs(q[0] - x0) < SQUARE || Math.abs(q[0] - x1) < SQUARE) && (Math.abs(q[1] - y0) < SQUARE || Math.abs(q[1] - y1) < SQUARE)) ? [x0, y0, x1, y1] : null
  }

  /** a mark a bullet could be: about as wide as tall and no bigger than a small letter */
  private dot(x0: number, y0: number, x1: number, y1: number) {
    const [w, h] = [x1 - x0, y1 - y0]
    if (w >= 1.5 && h >= 1.5 && w <= 10 && h <= 10 && Math.max(w, h) / Math.min(w, h) < 1.6) this.shapes.dots.push({ x0, y0, x1, y1, color: this.fillStyle })
  }

  fill() {
    for (const s of this.subs) {
      if (this.count() > MAX_SHAPES) return
      if (s.curved) {
        const xs = s.pts.map((q) => q[0])
        const ys = s.pts.map((q) => q[1])
        this.dot(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
        continue
      }
      const b = this.box(s)
      if (!b) continue
      const [x0, y0, x1, y1] = b
      if (Math.min(x1 - x0, y1 - y0) < HAIRLINE) {
        if (Math.max(x1 - x0, y1 - y0) >= 2) {
          const horizontal = x1 - x0 >= y1 - y0
          this.shapes.rules.push({ x0, y0: horizontal ? (y0 + y1) / 2 : y0, x1, y1: horizontal ? (y0 + y1) / 2 : y1, width: Math.max(0.25, Math.min(x1 - x0, y1 - y0)), color: this.fillStyle })
          if (!horizontal) { const r = this.shapes.rules[this.shapes.rules.length - 1]; r.x0 = r.x1 = (x0 + x1) / 2 }
        }
      } else {
        this.shapes.fills.push({ x0, y0, x1, y1, color: this.fillStyle })
        this.dot(x0, y0, x1, y1)
      }
    }
  }

  stroke() {
    const width = this.lineWidth * scaleOf(this.m)
    const add = (a: [number, number], b: [number, number]) => {
      const dx = Math.abs(b[0] - a[0])
      const dy = Math.abs(b[1] - a[1])
      if (Math.max(dx, dy) < 2) return
      if (dy < SQUARE) this.shapes.rules.push({ x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: (a[1] + b[1]) / 2, y1: (a[1] + b[1]) / 2, width, color: this.strokeStyle })
      else if (dx < SQUARE) this.shapes.rules.push({ y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]), x0: (a[0] + b[0]) / 2, x1: (a[0] + b[0]) / 2, width, color: this.strokeStyle })
    }
    for (const s of this.subs) {
      if (this.count() > MAX_SHAPES) return
      for (let i = 1; i < s.pts.length; i++) if (!s.bent[i]) add(s.pts[i - 1], s.pts[i])
    }
  }
}
