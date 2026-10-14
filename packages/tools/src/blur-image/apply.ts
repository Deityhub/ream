// What "blur or hide" does to a picture. Shared by the run and by the panel, which shows the same result on a smaller copy.
import { blur, fill, pixelate, type Area, type ImageBuffer } from '@ream/image-core'
import type { Rect } from '../rect.ts'

export type BlurOptions = {
  /** the parts to treat, as fractions of the picture */
  areas: Rect[]
  mode: 'blur' | 'pixelate' | 'box'
  /** 1..100, relative to the size of each area, so a small face and a wide banner get the same look */
  strength: number
  colour: string
}

export const defaultOptions: BlurOptions = { areas: [], mode: 'pixelate', strength: 60, colour: '#000000' }

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const toArea = (r: Rect, width: number, height: number): Area => {
  const x = Math.round(r.x * width)
  const y = Math.round(r.y * height)
  return { x, y, w: Math.max(1, Math.round((r.x + r.w) * width) - x), h: Math.max(1, Math.round((r.y + r.h) * height) - y) }
}

export function applyAreas(img: ImageBuffer, o: BlurOptions): void {
  for (const r of o.areas) {
    const a = toArea(r, img.width, img.height)
    const scale = (Math.min(a.w, a.h) * o.strength) / 100
    if (o.mode === 'box') fill(img, hex(o.colour), a)
    else if (o.mode === 'pixelate') pixelate(img, Math.max(2, Math.round(scale / 3)), a)
    else blur(img, Math.max(2, Math.round(scale / 3)), a)
  }
}
