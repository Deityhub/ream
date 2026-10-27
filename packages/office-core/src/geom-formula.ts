// DrawingML shape guides: the small formula language custom shapes (and preset shapes) use for their points.
// "*/ a b c" is a*b/c, "+- a b c" is a+b-c, and so on; names refer to earlier guides or to the box (w, h, wd2, ss ...).

/** angles in guides are 60000ths of a degree */
const rad = (a: number) => (a / 60000) * (Math.PI / 180)

/** the box's built-in names for a shape w x h */
export function boxGuides(w: number, h: number): Map<string, number> {
  const ss = Math.min(w, h)
  const ls = Math.max(w, h)
  const g = new Map<string, number>([
    ['w', w], ['h', h], ['l', 0], ['t', 0], ['r', w], ['b', h], ['hc', w / 2], ['vc', h / 2], ['ss', ss], ['ls', ls],
    ['3cd4', 16200000], ['3cd8', 8100000], ['5cd8', 13500000], ['7cd8', 18900000], ['cd2', 10800000], ['cd4', 5400000], ['cd8', 2700000],
  ])
  for (const d of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) {
    g.set(`wd${d}`, w / d)
    g.set(`hd${d}`, h / d)
    g.set(`ssd${d}`, ss / d)
  }
  return g
}

/** evaluate one guide formula with the names known so far; unknown names count as numbers when they are numbers, else 0 */
export function evalGuide(fmla: string, names: Map<string, number>): number {
  const [op, ...args] = fmla.trim().split(/\s+/)
  const v = args.map((a) => (names.has(a) ? names.get(a)! : Number(a) || 0))
  const [x, y, z] = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0]
  switch (op) {
    case 'val': return x
    case '*/': return z ? (x * y) / z : 0
    case '+-': return x + y - z
    case '+/': return z ? (x + y) / z : 0
    case '?:': return x > 0 ? y : z
    case 'abs': return Math.abs(x)
    case 'at2': return (Math.atan2(y, x) * 180 * 60000) / Math.PI
    case 'cat2': return x * Math.cos(Math.atan2(z, y))
    case 'sat2': return x * Math.sin(Math.atan2(z, y))
    case 'cos': return x * Math.cos(rad(y))
    case 'sin': return x * Math.sin(rad(y))
    case 'tan': return x * Math.tan(rad(y))
    case 'max': return Math.max(x, y)
    case 'min': return Math.min(x, y)
    case 'mod': return Math.sqrt(x * x + y * y + z * z)
    case 'pin': return y < x ? x : y > z ? z : y
    case 'sqrt': return Math.sqrt(Math.max(0, x))
    default: return 0
  }
}
