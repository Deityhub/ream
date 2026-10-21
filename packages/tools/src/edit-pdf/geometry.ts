// Moving, resizing and snapping items, and picking page text for markup: plain functions on page fractions, so the
// editor's behaviour can be tested without a browser.
import type { Rect } from '../rect.ts'
import type { Item, Point } from './items.ts'

/** the box an item takes on the page (lines, drawings and notes get the box around their points) */
export function boxOf(item: Item): Rect {
  if ('box' in item) return item.box
  const pts: Point[] = item.kind === 'line' ? [item.from, item.to] : item.kind === 'draw' ? item.strokes.flat() : item.kind === 'note' ? [item.at] : item.quads.flat()
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)]
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 }
}

/** the item moved by dx, dy (fractions of the page) */
export function moved(item: Item, dx: number, dy: number): Item {
  const p = (q: Point): Point => ({ x: q.x + dx, y: q.y + dy })
  if ('box' in item) return { ...item, box: { ...item.box, x: item.box.x + dx, y: item.box.y + dy } } as Item
  if (item.kind === 'line') return { ...item, from: p(item.from), to: p(item.to) }
  if (item.kind === 'draw') return { ...item, strokes: item.strokes.map((s) => s.map(p)) }
  if (item.kind === 'note') return { ...item, at: p(item.at) }
  return { ...item, quads: item.quads.map((q) => q.map(p) as typeof q) }
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const MIN = 0.01

/** a box with one side or corner dragged to `to`; `keep` holds the shape of the box (pictures) */
export function resized(box: Rect, handle: Handle, to: Point, keep = false): Rect {
  let [x0, y0, x1, y1] = [box.x, box.y, box.x + box.w, box.y + box.h]
  if (handle.includes('w')) x0 = Math.min(to.x, x1 - MIN)
  if (handle.includes('e')) x1 = Math.max(to.x, x0 + MIN)
  if (handle.includes('n')) y0 = Math.min(to.y, y1 - MIN)
  if (handle.includes('s')) y1 = Math.max(to.y, y0 + MIN)
  if (keep && box.w > 0 && box.h > 0 && handle.length === 2) {
    // the corner follows the pointer along the box's own diagonal
    const ratio = box.h / box.w
    const w = Math.max(x1 - x0, (y1 - y0) / ratio)
    if (handle.includes('w')) x0 = x1 - w
    else x1 = x0 + w
    if (handle.includes('n')) y0 = y1 - w * ratio
    else y1 = y0 + w * ratio
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** where the edges and middles of boxes are, across and down, for snapping */
const edges = (r: Rect) => ({ x: [r.x, r.x + r.w / 2, r.x + r.w], y: [r.y, r.y + r.h / 2, r.y + r.h] })

/**
 * The move that brings a box's edges or middle onto the page's edges or middle, or another box's, when within `tol`
 * (fractions across and down); with the lines it lines up with, for guides.
 */
export function snap(box: Rect, others: Rect[], tol: { x: number; y: number }): { dx: number; dy: number; guides: { x: number[]; y: number[] } } {
  const page = { x: [0, 0.5, 1], y: [0, 0.5, 1] }
  const targets = { x: [...page.x, ...others.flatMap((o) => edges(o).x)], y: [...page.y, ...others.flatMap((o) => edges(o).y)] }
  const mine = edges(box)
  const best = (axis: 'x' | 'y') => {
    let d = Infinity
    for (const m of mine[axis]) for (const t of targets[axis]) if (Math.abs(t - m) < Math.abs(d)) d = t - m
    return Math.abs(d) <= tol[axis] ? d : 0
  }
  const dx = best('x')
  const dy = best('y')
  // the lines the box now sits on (its own edges count when it already lined up)
  const after = edges({ ...box, x: box.x + dx, y: box.y + dy })
  const on = (axis: 'x' | 'y') => [...new Set(targets[axis].filter((t) => after[axis].some((m) => Math.abs(t - m) < 1e-9)))]
  return { dx, dy, guides: { x: on('x'), y: on('y') } }
}

/** a letter of the page with its box, as fractions of the page as displayed (y from the top) */
export type PageChar = { text: string; x0: number; y0: number; x1: number; y1: number }

/**
 * The page's text under a dragged box, for markup: the letters whose boxes meet it, one quad per line (letters on
 * about the same baseline), in reading order, with the text they spell.
 */
export function pickText(chars: PageChar[], area: Rect): { quads: [Point, Point, Point, Point][]; text: string } {
  const hit = chars.filter((c) => c.text.trim() && c.x1 > area.x && c.x0 < area.x + area.w && c.y1 > area.y && c.y0 < area.y + area.h)
  const lines: PageChar[][] = []
  for (const c of hit) {
    const h = c.y1 - c.y0
    const line = lines.find((l) => Math.abs(l[0].y1 - c.y1) < h * 0.5)
    if (line) line.push(c)
    else lines.push([c])
  }
  lines.sort((a, b) => a[0].y0 - b[0].y0)
  const quads = lines.map((l): [Point, Point, Point, Point] => {
    const [x0, x1] = [Math.min(...l.map((c) => c.x0)), Math.max(...l.map((c) => c.x1))]
    const [y0, y1] = [Math.min(...l.map((c) => c.y0)), Math.max(...l.map((c) => c.y1))]
    return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }]
  })
  const text = lines.map((l) => l.sort((a, b) => a.x0 - b.x0).map((c) => c.text).join('')).join(' ')
  return { quads, text }
}
