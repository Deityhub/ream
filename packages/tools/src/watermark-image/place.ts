// Where a watermark goes on a picture. Constants and plain maths only: the panel and the run both use it.
import type { Spot } from '../pdf-common.ts'

export type PlaceOptions = {
  /** the mark's width as a percentage of the picture's width */
  size: number
  layout: 'single' | 'tile'
  spot: Spot
  /** distance from the edges for a single mark, as a percentage of the picture's width */
  margin: number
  /** gap between repeated marks, as a percentage of the mark's size */
  spacing: number
}

/** the size to draw the mark at: as wide as asked, but a single mark never taller than the picture */
export function markSize(img: { width: number; height: number }, mark: { width: number; height: number }, o: PlaceOptions): { w: number; h: number } {
  let w = Math.max(1, Math.round((img.width * o.size) / 100))
  let h = Math.max(1, Math.round((w * mark.height) / mark.width))
  if (o.layout === 'single' && h > img.height) {
    h = img.height
    w = Math.max(1, Math.round((h * mark.width) / mark.height))
  }
  return { w, h }
}

/** top-left corners of every copy of a mark of size w x h */
export function placements(img: { width: number; height: number }, w: number, h: number, o: PlaceOptions): { x: number; y: number }[] {
  if (o.layout === 'single') {
    const m = Math.round((img.width * o.margin) / 100)
    const x = o.spot[1] === 'l' ? m : o.spot[1] === 'r' ? img.width - w - m : (img.width - w) / 2
    const y = o.spot[0] === 't' ? m : o.spot[0] === 'b' ? img.height - h - m : (img.height - h) / 2
    return [{ x, y }]
  }
  // repeated: rows offset by half a step so the marks don't line up in columns, the pattern centred on the picture
  const gx = w * (1 + o.spacing / 100)
  const gy = h * (1 + o.spacing / 100)
  const out: { x: number; y: number }[] = []
  const rows = Math.ceil(img.height / gy) + 1
  const cols = Math.ceil(img.width / gx) + 1
  for (let j = -rows; j <= rows; j++) {
    for (let i = -cols; i <= cols; i++) {
      const x = (img.width - w) / 2 + i * gx + (j % 2 ? gx / 2 : 0)
      const y = (img.height - h) / 2 + j * gy
      if (x < img.width && y < img.height && x + w > 0 && y + h > 0) out.push({ x, y })
    }
  }
  return out
}
