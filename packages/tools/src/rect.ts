// Rectangles as fractions of something being cropped. Plain functions (no React) so engines and tests can use them.

/** the area to keep, as fractions (0..1) of what is being cropped, so it doesn't depend on its pixel size */
export type Rect = { x: number; y: number; w: number; h: number }

export const WHOLE: Rect = { x: 0, y: 0, w: 1, h: 1 }
export const MIN = 0.01
export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
export const isWhole = (r: Rect) => r.x <= 0.001 && r.y <= 0.001 && r.w >= 0.998 && r.h >= 0.998

export type Point = { x: number; y: number }

/** rectangle spanning two corner points, kept inside the area and at least MIN wide and tall */
export function between(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x: Math.min(x, 1 - MIN), y: Math.min(y, 1 - MIN), w: clamp(Math.abs(a.x - b.x), MIN, 1 - x), h: clamp(Math.abs(a.y - b.y), MIN, 1 - y) }
}

/** set one side of a rectangle from a fraction, keeping it inside and at least MIN big (the numeric fields use this) */
export function withSide(r: Rect, key: keyof Rect, frac: number): Rect {
  const next = { ...r }
  if (key === 'x') next.x = clamp(frac, 0, 1 - MIN)
  else if (key === 'y') next.y = clamp(frac, 0, 1 - MIN)
  else if (key === 'w') next.w = clamp(frac, MIN, 1 - r.x)
  else next.h = clamp(frac, MIN, 1 - r.y)
  next.w = Math.min(next.w, 1 - next.x)
  next.h = Math.min(next.h, 1 - next.y)
  return next
}

