import type { Seg } from '@ream/pdf-core'

const K = 0.5522847498 // a circle quarter as a cubic curve

export type Outline = { segs: Seg[]; /** an open line (connectors): stroked only, never filled */ open?: boolean; /** holes are cut with the even-odd rule */ evenOdd?: boolean }

/** a preset's adjustment as a share (the file stores 1/100000ths), or its default */
const adj = (a: Record<string, number> | undefined, name: string, def: number) => (a?.[name] ?? def) / 100000

function ellipse(cx: number, cy: number, rx: number, ry: number): Seg[] {
  return [['M', cx + rx, cy], ['C', cx + rx, cy + K * ry, cx + K * rx, cy + ry, cx, cy + ry], ['C', cx - K * rx, cy + ry, cx - rx, cy + K * ry, cx - rx, cy], ['C', cx - rx, cy - K * ry, cx - K * rx, cy - ry, cx, cy - ry], ['C', cx + K * rx, cy - ry, cx + rx, cy - K * ry, cx + rx, cy], ['Z']]
}

/** a box with each corner rounded by its own radius (top-left, top-right, bottom-right, bottom-left), or cut when `snip` */
function corners(x: number, y: number, w: number, h: number, [tl, tr, br, bl]: number[], snip = false): Seg[] {
  const c = (r: number, x0: number, y0: number, x1: number, y1: number, cx: number, cy: number): Seg => (snip || !r ? ['L', x1, y1] : ['C', x0 + (cx - x0) * K, y0 + (cy - y0) * K, x1 + (cx - x1) * K, y1 + (cy - y1) * K, x1, y1])
  return [
    ['M', x + tl, y], ['L', x + w - tr, y], c(tr, x + w - tr, y, x + w, y + tr, x + w, y),
    ['L', x + w, y + h - br], c(br, x + w, y + h - br, x + w - br, y + h, x + w, y + h),
    ['L', x + bl, y + h], c(bl, x + bl, y + h, x, y + h - bl, x, y + h),
    ['L', x, y + tl], c(tl, x, y + tl, x + tl, y, x, y),
    ['Z'],
  ]
}

function star(x: number, y: number, w: number, h: number, points: number, inner: number): Seg[] {
  const segs: Seg[] = []
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points
    const r = i % 2 ? inner : 1
    segs.push([i ? 'L' : 'M', x + w / 2 + (w / 2) * r * Math.cos(a), y + h / 2 + (h / 2) * r * Math.sin(a)])
  }
  segs.push(['Z'])
  return segs
}

/**
 * The outline of a preset shape in a box, with the file's adjustments. ponytail: about 50 presets; any other name is
 * drawn as a plain rectangle, so a shape we don't know shows as its box. Add outlines as decks need them.
 */
export function geometryPath(prst: string, x: number, y: number, w: number, h: number, a?: Record<string, number>): Outline {
  const ss = Math.min(w, h)
  const poly = (pts: [number, number][]): Seg[] => [...pts.map(([px, py], i): Seg => [i ? 'L' : 'M', x + px * w, y + py * h]), ['Z']]
  const open = (pts: [number, number][]): Outline => ({ segs: pts.map(([px, py], i): Seg => [i ? 'L' : 'M', x + px * w, y + py * h]), open: true })
  switch (prst) {
    case 'ellipse':
    case 'flowChartConnector':
    case 'cloud':
    case 'cloudCallout':
      return { segs: ellipse(x + w / 2, y + h / 2, w / 2, h / 2) }
    case 'roundRect': {
      const r = Math.min(adj(a, 'adj', 16667), 0.5) * ss
      return { segs: corners(x, y, w, h, [r, r, r, r]) }
    }
    case 'flowChartAlternateProcess': return { segs: corners(x, y, w, h, Array(4).fill(ss / 6)) }
    case 'flowChartTerminator': return { segs: corners(x, y, w, h, Array(4).fill(Math.min(w, h) / 2)) }
    case 'round1Rect': return { segs: corners(x, y, w, h, [0, adj(a, 'adj', 16667) * ss, 0, 0]) }
    case 'round2SameRect': {
      const r1 = adj(a, 'adj1', 16667) * ss
      const r2 = adj(a, 'adj2', 0) * ss
      return { segs: corners(x, y, w, h, [r1, r1, r2, r2]) }
    }
    case 'round2DiagRect': {
      const r1 = adj(a, 'adj1', 16667) * ss
      const r2 = adj(a, 'adj2', 0) * ss
      return { segs: corners(x, y, w, h, [r1, r2, r1, r2]) }
    }
    case 'snip1Rect': return { segs: corners(x, y, w, h, [0, adj(a, 'adj', 16667) * ss, 0, 0], true) }
    case 'snip2SameRect': {
      const r1 = adj(a, 'adj1', 16667) * ss
      return { segs: corners(x, y, w, h, [r1, r1, adj(a, 'adj2', 0) * ss, adj(a, 'adj2', 0) * ss], true) }
    }
    case 'snip2DiagRect': {
      const r1 = adj(a, 'adj1', 0) * ss
      const r2 = adj(a, 'adj2', 16667) * ss
      return { segs: corners(x, y, w, h, [r1, r2, r1, r2], true) }
    }
    case 'snipRoundRect': return { segs: corners(x, y, w, h, [adj(a, 'adj1', 16667) * ss, adj(a, 'adj2', 16667) * ss, 0, 0]) }
    case 'triangle':
    case 'flowChartExtract': return { segs: poly([[adj(a, 'adj', 50000), 0], [1, 1], [0, 1]]) }
    case 'flowChartMerge': return { segs: poly([[0, 0], [1, 0], [0.5, 1]]) }
    case 'rtTriangle': return { segs: poly([[0, 0], [1, 1], [0, 1]]) }
    case 'diamond':
    case 'flowChartDecision': return { segs: poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]) }
    case 'parallelogram':
    case 'flowChartInputOutput': {
      const o = Math.min((prst === 'parallelogram' ? adj(a, 'adj', 25000) : 0.2) * ss, w) / w
      return { segs: poly([[o, 0], [1, 0], [1 - o, 1], [0, 1]]) }
    }
    case 'trapezoid': {
      const o = Math.min(adj(a, 'adj', 25000) * ss, w / 2) / w
      return { segs: poly([[o, 0], [1 - o, 0], [1, 1], [0, 1]]) }
    }
    case 'pentagon': return { segs: poly([[0.5, 0], [1, 0.382], [0.809, 1], [0.191, 1], [0, 0.382]]) }
    case 'hexagon':
    case 'flowChartPreparation': {
      const o = Math.min(adj(a, 'adj', 25000) * ss, w / 2) / w
      return { segs: poly([[o, 0], [1 - o, 0], [1, 0.5], [1 - o, 1], [o, 1], [0, 0.5]]) }
    }
    case 'octagon': {
      const o = Math.min(adj(a, 'adj', 29289) * ss, ss / 2)
      const [ox, oy] = [o / w, o / h]
      return { segs: poly([[ox, 0], [1 - ox, 0], [1, oy], [1, 1 - oy], [1 - ox, 1], [ox, 1], [0, 1 - oy], [0, oy]]) }
    }
    case 'plus': {
      const o = Math.min(adj(a, 'adj', 25000) * ss, ss / 2)
      const [ox, oy] = [o / w, o / h]
      return { segs: poly([[ox, 0], [1 - ox, 0], [1 - ox, oy], [1, oy], [1, 1 - oy], [1 - ox, 1 - oy], [1 - ox, 1], [ox, 1], [ox, 1 - oy], [0, 1 - oy], [0, oy], [ox, oy]]) }
    }
    case 'rightArrow':
    case 'leftArrow': {
      const shaft = adj(a, 'adj1', 50000)
      const head = Math.min(adj(a, 'adj2', 50000) * ss, w) / w
      const [t, b] = [(1 - shaft) / 2, (1 + shaft) / 2]
      const pts: [number, number][] = [[0, t], [1 - head, t], [1 - head, 0], [1, 0.5], [1 - head, 1], [1 - head, b], [0, b]]
      return { segs: poly(prst === 'rightArrow' ? pts : pts.map(([px, py]) => [1 - px, py])) }
    }
    case 'upArrow':
    case 'downArrow': {
      const shaft = adj(a, 'adj1', 50000)
      const head = Math.min(adj(a, 'adj2', 50000) * ss, h) / h
      const [l, r] = [(1 - shaft) / 2, (1 + shaft) / 2]
      const pts: [number, number][] = [[l, 1], [l, head], [0, head], [0.5, 0], [1, head], [r, head], [r, 1]]
      return { segs: poly(prst === 'upArrow' ? pts : pts.map(([px, py]) => [px, 1 - py])) }
    }
    case 'leftRightArrow': {
      const shaft = adj(a, 'adj1', 50000)
      const head = Math.min(adj(a, 'adj2', 50000) * ss, w / 2) / w
      const [t, b] = [(1 - shaft) / 2, (1 + shaft) / 2]
      return { segs: poly([[0, 0.5], [head, 0], [head, t], [1 - head, t], [1 - head, 0], [1, 0.5], [1 - head, 1], [1 - head, b], [head, b], [head, 1]]) }
    }
    case 'chevron': {
      const d = Math.min(adj(a, 'adj', 50000) * ss, w) / w
      return { segs: poly([[0, 0], [1 - d, 0], [1, 0.5], [1 - d, 1], [0, 1], [d, 0.5]]) }
    }
    case 'homePlate': {
      const d = Math.min(adj(a, 'adj', 50000) * ss, w) / w
      return { segs: poly([[0, 0], [1 - d, 0], [1, 0.5], [1 - d, 1], [0, 1]]) }
    }
    case 'star4': return { segs: star(x, y, w, h, 4, adj(a, 'adj', 12500) * 2) }
    case 'star5': return { segs: star(x, y, w, h, 5, adj(a, 'adj', 19098) * 2) }
    case 'star6': return { segs: star(x, y, w, h, 6, adj(a, 'adj', 28868) * 2) }
    case 'star7': return { segs: star(x, y, w, h, 7, adj(a, 'adj', 34601) * 2) }
    case 'star8': return { segs: star(x, y, w, h, 8, adj(a, 'adj', 38250) * 2) }
    case 'star10': return { segs: star(x, y, w, h, 10, adj(a, 'adj', 42533) * 2) }
    case 'star12':
    case 'star16':
    case 'star24':
    case 'star32': return { segs: star(x, y, w, h, Number(prst.slice(4)), adj(a, 'adj', 37500) * 2) }
    case 'donut': {
      const t = Math.min(adj(a, 'adj', 25000) * ss, ss / 2)
      return { segs: [...ellipse(x + w / 2, y + h / 2, w / 2, h / 2), ...ellipse(x + w / 2, y + h / 2, w / 2 - t, h / 2 - t)], evenOdd: true }
    }
    case 'frame': {
      const t = Math.min(adj(a, 'adj1', 12500) * ss, ss / 2)
      return { segs: [...corners(x, y, w, h, [0, 0, 0, 0]), ...corners(x + t, y + t, w - 2 * t, h - 2 * t, [0, 0, 0, 0])], evenOdd: true }
    }
    case 'wedgeRectCallout':
    case 'wedgeRoundRectCallout':
    case 'wedgeEllipseCallout': {
      // the body, plus a tail to the point the adjustments give (shares of the size from the middle)
      const px = x + w / 2 + adj(a, 'adj1', -20833) * w
      const py = y + h / 2 + adj(a, 'adj2', 62500) * h
      const body = prst === 'wedgeEllipseCallout' ? ellipse(x + w / 2, y + h / 2, w / 2, h / 2) : corners(x, y, w, h, Array(4).fill(prst === 'wedgeRoundRectCallout' ? ss / 6 : 0))
      const [bx, by] = [Math.min(Math.max(px, x + w * 0.2), x + w * 0.8), Math.min(Math.max(py, y + h * 0.2), y + h * 0.8)]
      const horizontal = Math.abs(px - (x + w / 2)) / w > Math.abs(py - (y + h / 2)) / h
      const base = horizontal ? [[px < x + w / 2 ? x + 1 : x + w - 1, by - h * 0.08], [px < x + w / 2 ? x + 1 : x + w - 1, by + h * 0.08]] : [[bx - w * 0.08, py < y + h / 2 ? y + 1 : y + h - 1], [bx + w * 0.08, py < y + h / 2 ? y + 1 : y + h - 1]]
      return { segs: [...body, ['M', base[0][0], base[0][1]], ['L', px, py], ['L', base[1][0], base[1][1]], ['Z']] }
    }
    case 'bentConnector2': return open([[0, 0], [1, 0], [1, 1]])
    case 'bentConnector3': {
      const m = adj(a, 'adj1', 50000)
      return open([[0, 0], [m, 0], [m, 1], [1, 1]])
    }
    case 'bentConnector4':
    case 'bentConnector5': return open([[0, 0], [0.5, 0], [0.5, 1], [1, 1]])
    case 'curvedConnector2':
    case 'curvedConnector3':
    case 'curvedConnector4':
    case 'curvedConnector5': return { segs: [['M', x, y], ['C', x + w / 2, y, x + w / 2, y + h, x + w, y + h]], open: true }
    default: return { segs: poly([[0, 0], [1, 0], [1, 1], [0, 1]]) }
  }
}
