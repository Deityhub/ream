// Putting one picture on another. Straight (non-premultiplied) RGBA, source-over.
import type { ImageBuffer } from './buffer.ts'

/**
 * Draw `layer` onto `dst` with its top-left corner at (x, y), at `opacity` (0..1), changing `dst` in place.
 * Parts outside `dst` are clipped. A translucent layer over a translucent base gives the right alpha too.
 */
export function overlay(dst: ImageBuffer, layer: ImageBuffer, x: number, y: number, opacity = 1): void {
  x = Math.round(x)
  y = Math.round(y)
  const x0 = Math.max(0, x)
  const x1 = Math.min(dst.width, x + layer.width)
  const y0 = Math.max(0, y)
  const y1 = Math.min(dst.height, y + layer.height)
  const d = dst.data
  const s = layer.data
  for (let py = y0; py < y1; py++) {
    let di = (py * dst.width + x0) * 4
    let si = ((py - y) * layer.width + (x0 - x)) * 4
    for (let px = x0; px < x1; px++, di += 4, si += 4) {
      const a = (s[si + 3] / 255) * opacity
      if (a <= 0) continue
      const ba = d[di + 3] / 255
      const out = a + ba * (1 - a)
      // each colour is weighted by how much of the result its layer covers
      const wl = a / out
      const wb = (ba * (1 - a)) / out
      d[di] = s[si] * wl + d[di] * wb
      d[di + 1] = s[si + 1] * wl + d[di + 1] * wb
      d[di + 2] = s[si + 2] * wl + d[di + 2] * wb
      d[di + 3] = out * 255
    }
  }
}
