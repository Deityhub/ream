import type { Seg } from '@ream/pdf-core'

const K = 0.5522847498 // a circle quarter as a cubic curve

/**
 * The outline of a preset shape in a box. ponytail: a dozen presets are drawn; every other name is drawn as a plain
 * rectangle, so an arrow or a callout we don't know shows as its box. Add outlines as decks need them.
 */
export function geometryPath(prst: string, x: number, y: number, w: number, h: number): Seg[] {
  const poly = (pts: [number, number][]): Seg[] => [...pts.map(([px, py], i): Seg => [i ? 'L' : 'M', x + px * w, y + py * h]), ['Z']]
  switch (prst) {
    case 'ellipse':
    case 'flowChartConnector': {
      const [cx, cy, rx, ry] = [x + w / 2, y + h / 2, w / 2, h / 2]
      return [['M', cx + rx, cy], ['C', cx + rx, cy + K * ry, cx + K * rx, cy + ry, cx, cy + ry], ['C', cx - K * rx, cy + ry, cx - rx, cy + K * ry, cx - rx, cy], ['C', cx - rx, cy - K * ry, cx - K * rx, cy - ry, cx, cy - ry], ['C', cx + K * rx, cy - ry, cx + rx, cy - K * ry, cx + rx, cy], ['Z']]
    }
    case 'roundRect':
    case 'flowChartTerminator': {
      const r = prst === 'roundRect' ? Math.min(w, h) * 0.16667 : Math.min(w, h) / 2
      const k = r * (1 - K)
      return [['M', x + r, y], ['L', x + w - r, y], ['C', x + w - k, y, x + w, y + k, x + w, y + r], ['L', x + w, y + h - r], ['C', x + w, y + h - k, x + w - k, y + h, x + w - r, y + h], ['L', x + r, y + h], ['C', x + k, y + h, x, y + h - k, x, y + h - r], ['L', x, y + r], ['C', x, y + k, x + k, y, x + r, y], ['Z']]
    }
    case 'triangle': return poly([[0.5, 0], [1, 1], [0, 1]])
    case 'rtTriangle': return poly([[0, 0], [1, 1], [0, 1]])
    case 'diamond':
    case 'flowChartDecision': return poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]])
    case 'parallelogram': return poly([[0.25, 0], [1, 0], [0.75, 1], [0, 1]])
    case 'trapezoid': return poly([[0.2, 0], [0.8, 0], [1, 1], [0, 1]])
    case 'hexagon': return poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]])
    case 'rightArrow': return poly([[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]])
    case 'leftArrow': return poly([[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]])
    case 'chevron': return poly([[0, 0], [0.7, 0], [1, 0.5], [0.7, 1], [0, 1], [0.3, 0.5]])
    case 'homePlate': return poly([[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1]])
    default: return poly([[0, 0], [1, 0], [1, 1], [0, 1]])
  }
}
