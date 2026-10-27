import { PdfStream, isDict, type PdfDict, type PdfDocument, type PdfObj } from '@ream/pdf-core'
import { css, loadColorSpace, type RGB } from './color.ts'
import { loadFunction, numbers, type PdfFunction } from './function.ts'
import type { Ctx2D } from './platform.ts'

/** an axial or radial shading, reduced to what a canvas gradient needs */
export type Shading = {
  type: 2 | 3
  /** axial: x0 y0 x1 y1; radial: x0 y0 r0 x1 y1 r1 */
  coords: number[]
  /** [position 0..1, css colour] */
  stops: [number, string][]
  /** the colour halfway along, used where a pattern can only be approximated by one colour */
  mid: RGB
  /** whether the colours continue past the start and the end (the /Extend entry, default no) */
  extend: [boolean, boolean]
}

const STOPS = 64

/** Read a shading dictionary. Returns null for kinds we can't draw yet (function-based and mesh shadings). */
export async function loadShading(doc: PdfDocument, obj: PdfObj | undefined, resources?: PdfDict): Promise<Shading | null> {
  const s = doc.resolve(obj)
  const dict = s instanceof PdfStream ? s.dict : isDict(s) ? s : null
  if (!dict) return null
  const type = doc.resolve(dict.get('ShadingType'))
  if (type !== 2 && type !== 3) return null
  const coords = numbers(doc, dict.get('Coords'))
  if (!coords || coords.length < (type === 2 ? 4 : 6)) return null
  const cs = await loadColorSpace(doc, dict.get('ColorSpace'), resources)
  const domain = numbers(doc, dict.get('Domain')) ?? [0, 1]

  // one function with n outputs, or an array of n functions with one output each
  const f = doc.resolve(dict.get('Function'))
  let colorAt: PdfFunction | null
  if (Array.isArray(f)) {
    const fns = await Promise.all(f.map((x) => loadFunction(doc, x)))
    colorAt = fns.every(Boolean) ? (t) => fns.map((fn) => fn!(t)[0]) : null
  } else colorAt = await loadFunction(doc, f)
  if (!colorAt) return null

  const at = (pos: number) => cs.rgb(colorAt!([domain[0] + pos * (domain[1] - domain[0])]))
  const stops: [number, string][] = []
  for (let i = 0; i <= STOPS; i++) stops.push([i / STOPS, css(at(i / STOPS))])
  const ext = doc.resolve(dict.get('Extend'))
  const flag = (i: number) => Array.isArray(ext) && doc.resolve(ext[i]) === true
  return { type, coords, stops, mid: at(0.5), extend: [flag(0), flag(1)] }
}

export function makeGradient(ctx: Ctx2D, s: Shading): CanvasGradient {
  const c = s.coords
  const g = s.type === 2 ? ctx.createLinearGradient(c[0], c[1], c[2], c[3]) : ctx.createRadialGradient(c[0], c[1], c[2], c[3], c[4], c[5])
  for (const [pos, color] of s.stops) g.addColorStop(pos, color)
  return g
}

/**
 * Canvas gradients always carry on past their ends, but a shading without /Extend must not paint there. Clip to the
 * area it does cover: the strip between the two end lines (axial), or the circles swept between the end circles (radial).
 */
export function clipToExtent(ctx: Ctx2D, s: Shading) {
  const [e0, e1] = s.extend
  if (e0 && e1) return
  const c = s.coords
  const path = new Path2D()
  if (s.type === 2) {
    const dx = c[2] - c[0]
    const dy = c[3] - c[1]
    const len = Math.hypot(dx, dy)
    if (len === 0) return
    const [ux, uy] = [dx / len, dy / len]
    const L = 1e6
    const a: [number, number] = [c[0] - (e0 ? ux * L : 0), c[1] - (e0 ? uy * L : 0)]
    const b: [number, number] = [c[2] + (e1 ? ux * L : 0), c[3] + (e1 ? uy * L : 0)]
    path.moveTo(a[0] - uy * L, a[1] + ux * L)
    path.lineTo(b[0] - uy * L, b[1] + ux * L)
    path.lineTo(b[0] + uy * L, b[1] - ux * L)
    path.lineTo(a[0] + uy * L, a[1] - ux * L)
    path.closePath()
  } else if (!e0 && !e1) {
    // the swept area is approximated by a union of circles along the way
    for (let i = 0; i <= 32; i++) {
      const t = i / 32
      const r = Math.max(0, c[2] + (c[5] - c[2]) * t)
      const x = c[0] + (c[3] - c[0]) * t
      const y = c[1] + (c[4] - c[1]) * t
      path.moveTo(x + r, y)
      path.arc(x, y, r, 0, Math.PI * 2)
    }
  } else return // extended at one end only: left padded
  ctx.clip(path)
}
