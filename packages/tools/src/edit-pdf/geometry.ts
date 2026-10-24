// Moving, resizing and snapping items, and picking page text for markup: plain functions on page fractions, so the
// editor's behaviour can be tested without a browser.
import type { Rect } from '../rect.ts'
import { itemsOn, type Item, type Point } from './items.ts'

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
 * The page's text under a dragged box, for markup, as the letters a person would say are under it: a letter is picked
 * when the drag covers at least half of it across and down (or all of the drag lies on it, for a thin sweep along a line:
 * "half" is of the smaller of the letter and the drag). Down, a letter is its capital-height band, not the line-tall box
 * it is stored with, so lines set close together are not picked by a drag that only grazes the next one.
 *
 * The result is one quad per run of letters on a line (a wide gap, such as between columns, starts a new run), in reading
 * order, with the text they spell. `aspect` is the page's width over its height, so gaps can be told in letter sizes.
 * Quads that would overlap the line above or below are trimmed to meet halfway.
 */
export function pickText(chars: PageChar[], area: Rect, aspect = 1): { quads: [Point, Point, Point, Point][]; text: string } {
  const over = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
  const hit = chars.filter((c) => {
    if (!c.text.trim()) return false
    const h = c.y1 - c.y0
    // a letter's box runs from 0.8 of its size above the baseline to 0.2 below; its capitals stand in the band from 0.1 to 0.8
    const [top, base] = [c.y0 + 0.1 * h, c.y0 + 0.8 * h]
    const across = over(c.x0, c.x1, area.x, area.x + area.w) >= 0.5 * Math.min(c.x1 - c.x0, area.w)
    const down = over(top, base, area.y, area.y + area.h) >= 0.5 * Math.min(base - top, area.h)
    return across && down
  })
  // lines: letters on about the same baseline
  const lines: PageChar[][] = []
  for (const c of hit) {
    const h = c.y1 - c.y0
    const line = lines.find((l) => Math.abs(l[0].y1 - c.y1) < h * 0.5)
    if (line) line.push(c)
    else lines.push([c])
  }
  lines.sort((a, b) => a[0].y0 - b[0].y0)
  // runs: a gap wider than one and a half letters starts another
  type Run = { chars: PageChar[]; x0: number; x1: number; y0: number; y1: number }
  const runs: Run[] = []
  for (const l of lines) {
    l.sort((a, b) => a.x0 - b.x0)
    let cur: PageChar[] = []
    const flush = () => {
      if (!cur.length) return
      runs.push({ chars: cur, x0: cur[0].x0, x1: Math.max(...cur.map((c) => c.x1)), y0: Math.min(...cur.map((c) => c.y0)), y1: Math.max(...cur.map((c) => c.y1)) })
      cur = []
    }
    for (const c of l) {
      const last = cur[cur.length - 1]
      if (last && c.x0 - last.x1 > (1.5 * (c.y1 - c.y0)) / aspect) flush()
      cur.push(c)
    }
    flush()
  }
  // trim what would overlap the line above or below, so two highlights meet instead of covering each other
  const bySide = [...runs].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  for (let i = 0; i < bySide.length; i++) {
    for (let j = i + 1; j < bySide.length; j++) {
      const [a, b] = [bySide[i], bySide[j]]
      if (b.y0 >= a.y1) break
      if (over(a.x0, a.x1, b.x0, b.x1) > 0 && b.y0 > a.y0) [a.y1, b.y0] = [(a.y1 + b.y0) / 2, (a.y1 + b.y0) / 2]
    }
  }
  const quads = runs.map((r): [Point, Point, Point, Point] => [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x0, y: r.y1 }, { x: r.x1, y: r.y1 }])
  // the words as they were set: a space where the letters stand apart
  const spell = (r: Run) => r.chars.reduce((t, c, k) => t + (k && c.x0 - r.chars[k - 1].x1 > (0.2 * (c.y1 - c.y0)) / aspect ? ' ' : '') + c.text, '')
  return { quads, text: runs.map(spell).join(' ') }
}

/**
 * The layers items are stacked in, bottom to top, as the saved file has them: the page's own content (and what was
 * changed in it), what was added to the page, comments (highlights, notes, links), form fields. Order in the list is
 * order in the stack within a layer; an item never goes into another layer.
 */
export type Layer = 'content' | 'marks' | 'comments' | 'fields'
export const layerOf = (i: Item): Layer => (i.kind === 'textline' || i.kind === 'picture' || i.kind === 'erase' ? 'content' : i.kind === 'markup' || i.kind === 'note' || i.kind === 'link' ? 'comments' : i.kind === 'field' ? 'fields' : 'marks')

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** the items of this one's layer on its page, in stacking order (bottom first) */
const layerMates = (items: Item[], me: Item) => {
  const shown = new Set(itemsOn(items, me.page))
  return items.filter((o) => layerOf(o) === layerOf(me) && shown.has(o))
}

/**
 * Where an item goes in one step forward (1) or back (-1), as the item it ends up just past: the next item it overlaps
 * in its layer, or when it overlaps none that way, the end of the layer (a step that passes nothing you can see would
 * look like a broken button). Null when it is already at that end.
 */
function target(items: Item[], id: string, by: 1 | -1): Item | null {
  const me = items.find((x) => x.id === id)
  if (!me || me.kind === 'erase') return null
  const mates = layerMates(items, me)
  const at = mates.indexOf(me)
  const beyond = by === 1 ? mates.slice(at + 1) : mates.slice(0, at).reverse()
  if (!beyond.length) return null
  return beyond.find((o) => overlaps(boxOf(me), boxOf(o))) ?? beyond[beyond.length - 1]
}

/** can the item go a step forward (1) or back (-1) in its layer? */
export const canStep = (items: Item[], id: string, by: 1 | -1) => target(items, id, by) !== null

/** the items with this one moved a step forward or back in its layer (see `target`); unchanged when it can't */
export function stepOrder(items: Item[], id: string, by: 1 | -1): Item[] {
  const past = target(items, id, by)
  if (!past) return items
  const me = items.find((x) => x.id === id)!
  const rest = items.filter((x) => x !== me)
  // right after the item it passes going forward, right before it going back
  rest.splice(rest.indexOf(past) + (by === 1 ? 1 : 0), 0, me)
  return rest
}
