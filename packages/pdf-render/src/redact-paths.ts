// Cutting a path at the edge of redaction areas: what is under an area is removed from the file, what is outside stays.
// Everything here works in the path's own space (the areas are brought into it as convex quadrilaterals).
import type { PdfObj } from '@ream/pdf-core'

export type Pt = [number, number]
export type Subpath = { pts: Pt[]; closed: boolean }

const num = (v: PdfObj | undefined) => (typeof v === 'number' ? v : 0)

/**
 * The subpaths of a path's construction operators as straight lines. `scale` is how many device units one path unit
 * is: curves are cut into pieces short enough to look smooth at four times that size.
 */
export function flattenPath(ops: { op: string; args: PdfObj[] }[], scale: number): Subpath[] {
  const subs: Subpath[] = []
  let cur: Subpath | null = null
  let at: Pt = [0, 0]
  let start: Pt = [0, 0]
  const lineTo = (p: Pt) => {
    if (!cur) subs.push((cur = { pts: [at], closed: false }))
    cur.pts.push(p)
    at = p
  }
  const curve = (p1: Pt, p2: Pt, p3: Pt) => {
    const p0 = at
    const len = (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1])) * scale * 4
    const n = Math.min(200, Math.max(4, Math.ceil(Math.sqrt(len) * 3)))
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const u = 1 - t
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
      lineTo([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]])
    }
  }
  for (const { op, args: a } of ops) {
    const n = (i: number) => num(a[i])
    if (op === 'm') {
      at = start = [n(0), n(1)]
      subs.push((cur = { pts: [at], closed: false }))
    } else if (op === 'l') lineTo([n(0), n(1)])
    else if (op === 'c') curve([n(0), n(1)], [n(2), n(3)], [n(4), n(5)])
    else if (op === 'v') curve(at, [n(0), n(1)], [n(2), n(3)])
    else if (op === 'y') curve([n(0), n(1)], [n(2), n(3)], [n(2), n(3)])
    else if (op === 'h') {
      if (cur) cur.closed = true
      cur = null
      at = start
    } else if (op === 're') {
      const [x, y, w, h] = [n(0), n(1), n(2), n(3)]
      subs.push({ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true })
      cur = null
      at = start = [x, y]
    }
  }
  return subs
}

/** the quadrilateral's corners turned counter-clockwise */
function ccw(q: Pt[]): Pt[] {
  let a = 0
  for (let i = 0; i < q.length; i++) {
    const [x1, y1] = q[i]
    const [x2, y2] = q[(i + 1) % q.length]
    a += x1 * y2 - x2 * y1
  }
  return a < 0 ? [...q].reverse() : q
}

/** which side of the line a->b a point is on: > 0 left (inside a counter-clockwise shape) */
const side = (a: Pt, b: Pt, p: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])

/** Sutherland-Hodgman: the polygon on one side of the line a->b (left when `left`) */
function clipHalf(poly: Pt[], a: Pt, b: Pt, left: boolean): Pt[] {
  const out: Pt[] = []
  const keep = (p: Pt) => (left ? side(a, b, p) >= 0 : side(a, b, p) <= 0)
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const kp = keep(p)
    const kq = keep(q)
    if (kp) out.push(p)
    if (kp !== kq) {
      const sp = side(a, b, p)
      const sq = side(a, b, q)
      const t = sp / (sp - sq)
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    }
  }
  return out
}

const area = (poly: Pt[]) => {
  let a = 0
  for (let i = 0; i < poly.length; i++) a += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1]
  return a / 2
}
/** a clipped piece worth keeping: something is left of it (zero-area slivers along the cut are dropped) */
const solid = (poly: Pt[]) => poly.length >= 3 && Math.abs(area(poly)) > 1e-9

/** whether a polygon and a convex quadrilateral share some area */
export const overlaps = (poly: Pt[], quad: Pt[]) => solid(inside(poly, quad))

/** the part of a polygon inside a convex quadrilateral */
function inside(poly: Pt[], quad: Pt[]): Pt[] {
  const q = ccw(quad)
  let p = poly
  for (let i = 0; i < 4 && p.length; i++) p = clipHalf(p, q[i], q[(i + 1) % 4], true)
  return p
}

/**
 * The polygons of a fill without the areas. The outside of each area is split into four regions that don't overlap
 * (beyond one edge and not beyond the edges before it), and each subpath is clipped to each region: clipping to a convex
 * region keeps every point's winding number, so the fill rule still works, and nothing is painted twice. The pieces
 * go in one path, so where they meet there is no seam.
 */
export function cutFill(subs: Subpath[], quads: Pt[][]): Pt[][] {
  let polys = subs.map((s) => s.pts)
  for (const quad of quads) {
    const q = ccw(quad)
    const next: Pt[][] = []
    for (const poly of polys) {
      for (let i = 0; i < 4; i++) {
        let p = clipHalf(poly, q[i], q[(i + 1) % 4], false)
        for (let j = 0; j < i && p.length; j++) p = clipHalf(p, q[j], q[(j + 1) % 4], true)
        if (solid(p)) next.push(p)
      }
    }
    polys = next
  }
  return polys
}

/** the parameter range [t0, t1] of segment p->q that lies inside a convex quadrilateral (Cyrus-Beck), or null */
function insideRange(p: Pt, q: Pt, quad: Pt[]): [number, number] | null {
  const c = ccw(quad)
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 4; i++) {
    const a = c[i]
    const b = c[(i + 1) % 4]
    const sp = side(a, b, p)
    const sq = side(a, b, q)
    if (sp < 0 && sq < 0) return null
    if (sp >= 0 && sq >= 0) continue
    const t = sp / (sp - sq)
    if (sp < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return null
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null
}

/**
 * The lines of a stroke without the parts under the areas, as open polylines (a closed subpath nothing touches stays
 * closed, so its corner joins are kept).
 */
export function cutStroke(subs: Subpath[], quads: Pt[][]): { pts: Pt[]; closed: boolean }[] {
  const out: { pts: Pt[]; closed: boolean }[] = []
  for (const s of subs) {
    const segs: [Pt, Pt][] = []
    for (let i = 0; i + 1 < s.pts.length; i++) segs.push([s.pts[i], s.pts[i + 1]])
    if (s.closed && s.pts.length > 1) segs.push([s.pts[s.pts.length - 1], s.pts[0]])
    const cuts = segs.map(([p, q]) => quads.map((quad) => insideRange(p, q, quad)).filter((r): r is [number, number] => !!r))
    if (cuts.every((c) => !c.length)) {
      out.push({ pts: s.pts, closed: s.closed })
      continue
    }
    let line: Pt[] | null = null
    const at = (p: Pt, q: Pt, t: number): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
    segs.forEach(([p, q], k) => {
      // the kept stretches of this segment: [0, 1] minus the ranges under areas
      const ranges = cuts[k].sort((a, b) => a[0] - b[0])
      let from = 0
      const kept: [number, number][] = []
      for (const [a, b] of ranges) {
        if (a > from) kept.push([from, a])
        from = Math.max(from, b)
      }
      if (from < 1) kept.push([from, 1])
      for (const [a, b] of kept) {
        if (line && a === 0) line.push(at(p, q, b))
        else {
          if (line) out.push({ pts: line, closed: false })
          line = [at(p, q, a), at(p, q, b)]
        }
        if (b < 1) {
          out.push({ pts: line, closed: false })
          line = null
        }
      }
      if (kept.length === 0 || kept[kept.length - 1][1] < 1) {
        if (line) out.push({ pts: line, closed: false })
        line = null
      }
    })
    if (line) out.push({ pts: line, closed: false })
  }
  return out.filter((l) => l.pts.length > 1)
}

/** whether any part of the path is under an area: a fill by its inside, a stroke by its lines */
export function touches(subs: Subpath[], quads: Pt[][], fill: boolean): boolean {
  for (const quad of quads) {
    for (const s of subs) {
      if (fill && solid(inside(s.pts, quad))) return true
      for (let i = 0; i + 1 < s.pts.length + (s.closed || fill ? 1 : 0); i++) {
        if (insideRange(s.pts[i], s.pts[(i + 1) % s.pts.length], quad)) return true
      }
    }
  }
  return false
}

const f = (v: number) => String(+v.toFixed(4))

/** content-stream path operators for polygons (closed) or polylines */
export function pathOps(lines: { pts: Pt[]; closed: boolean }[]): string {
  return lines.map((l) => l.pts.map((p, i) => `${f(p[0])} ${f(p[1])} ${i ? 'l' : 'm'}`).join(' ') + (l.closed ? ' h' : '')).join('\n')
}
