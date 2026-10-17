// Charts from Office files drawn into a box on a page: columns and bars (clustered, stacked, 100%), lines, areas, pies,
// doughnuts and scatter plots, with a title, a legend, value gridlines and axis labels, in the layout Office uses by
// default. Positions the file sets by hand (a moved legend or plot area), trendlines, error bars and secondary axes are
// not drawn. Shared by PowerPoint to PDF and Excel to PDF.
import { measure, type FontSpec, type PageDraw, type Seg } from '@ream/pdf-core'
import { formatValue, type Chart, type ChartPlot, type ChartSeries } from '@ream/office-core'
import type { FontBook, FontNeed } from './fonts/book.ts'
import { hexRgb } from './office-fonts.ts'

type Box = { x: number; y: number; w: number; h: number }
type Rgb = [number, number, number]

const GRID: Rgb = [217, 217, 217]
const AXIS: Rgb = [191, 191, 191]
const INK: Rgb = [89, 89, 89]
const DEFAULT_FONT = 'Calibri'
const DIGITS = '0123456789.,-–%()$€£¥ E+:/'

/** the text a chart needs from the fonts, for the font book to load */
export function chartFontNeeds(c: Chart): FontNeed[] {
  const text = [c.title ?? '', ...c.categories, ...c.plots.flatMap((p) => p.series.map((s) => s.name)), c.axisTitles.category ?? '', c.axisTitles.value ?? '', DIGITS].join(' ')
  return [{ name: c.font ?? DEFAULT_FONT, text }, { name: c.font ?? DEFAULT_FONT, bold: true, text: c.title ?? '' }]
}

/** "nice" axis bounds and step for values from lo to hi, about five steps */
function niceScale(lo: number, hi: number): { min: number; max: number; step: number } {
  if (lo === hi) { hi = lo + 1; lo = Math.min(0, lo) }
  const raw = (hi - lo) / 5
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  return { min: Math.floor(lo / step + 1e-9) * step, max: Math.ceil(hi / step - 1e-9) * step, step }
}

/** a pie slice or a ring segment from angle a0 to a1 (radians clockwise from the top) */
function slice(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): Seg[] {
  const pt = (rad: number, a: number): [number, number] => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)]
  const arc = (rad: number, from: number, to: number): Seg[] => {
    const out: Seg[] = []
    const n = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 2)))
    const d = (to - from) / n
    const k = (4 / 3) * Math.tan(d / 4)
    for (let i = 0; i < n; i++) {
      const s = from + i * d
      const e = s + d
      const [x0, y0] = pt(rad, s)
      const [x1, y1] = pt(rad, e)
      // tangent of a clockwise-from-top angle: (cos a, sin a)
      out.push(['C', x0 + k * rad * Math.cos(s), y0 + k * rad * Math.sin(s), x1 - k * rad * Math.cos(e), y1 - k * rad * Math.sin(e), x1, y1])
    }
    return out
  }
  if (inner > 0) return [['M', ...pt(r, a0)], ...arc(r, a0, a1), ['L', ...pt(inner, a1)], ...arc(inner, a1, a0), ['Z']]
  if (a1 - a0 >= Math.PI * 2 - 1e-9) return [['M', ...pt(r, a0)], ...arc(r, a0, a1), ['Z']]
  return [['M', cx, cy], ['L', ...pt(r, a0)], ...arc(r, a0, a1), ['Z']]
}

const colorOf = (c: Chart, s: ChartSeries, i: number): Rgb => hexRgb(s.color ?? shade(c.palette, i))
/** the accents in turn; after the sixth, darker versions of them, as Office does */
const shade = (palette: string[], i: number) => {
  const base = hexRgb(palette[i % palette.length])
  const round = Math.floor(i / palette.length)
  const f = round === 0 ? 1 : round % 2 ? 0.6 : 0.8
  return base.map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('')
}

/** `defaults` is the chart area's look when the file leaves it out: Excel draws charts on white with a grey edge, PowerPoint on nothing */
export function drawChart(page: PageDraw, c: Chart, box: Box, book: FontBook, defaults: { fill?: string; line?: string } = {}): void {
  const font = book.spec(c.font ?? DEFAULT_FONT, false, false)
  const ts = c.textSize
  const ink = hexRgb(c.textColor, INK)
  const text = (x: number, y: number, s: string, size = ts, align: 'left' | 'center' | 'right' = 'left', f: FontSpec = font, color = ink) => {
    const w = measure(s, size, f)
    page.text(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x, y, s, f, size, color)
    return w
  }
  const fill = c.area.fill === undefined ? defaults.fill : c.area.fill
  const edge = c.area.line === undefined ? defaults.line : c.area.line
  if (fill) page.fillRect(box.x, box.y, box.w, box.h, hexRgb(fill))
  if (edge) page.path([['M', box.x, box.y], ['L', box.x + box.w, box.y], ['L', box.x + box.w, box.y + box.h], ['L', box.x, box.y + box.h], ['Z']], { stroke: hexRgb(edge), width: 0.75 })
  page.save()
  page.clip(box.x, box.y, box.w, box.h)
  const pad = Math.max(4, Math.min(box.w, box.h) * 0.04)
  let top = box.y + pad
  let bottom = box.y + box.h - pad
  let left = box.x + pad
  let right = box.x + box.w - pad

  if (c.title) {
    const size = ts * 1.4
    for (const line of c.title.split('\n')) {
      text(box.x + box.w / 2, top + size, line, size, 'center')
      top += size * 1.25
    }
    top += size * 0.3
  }

  // the legend: series, or the slices of a pie
  const round = c.plots.every((p) => p.kind === 'pie' || p.kind === 'doughnut')
  const first = c.plots[0]
  const entries: { name: string; color: Rgb; line: boolean }[] = round || (c.plots.length === 1 && first.vary && first.series.length === 1)
    ? c.categories.map((name, i) => ({ name, color: hexRgb(first.series[0].pointColors?.[i] ?? shade(c.palette, i)), line: false }))
    : c.plots.flatMap((p) => p.series.map((s) => ({ s, p }))).map(({ s, p }, i) => ({ name: s.name, color: colorOf(c, s, i), line: p.kind === 'line' || (p.kind === 'scatter' && s.line) }))
  if (c.legend && entries.length) {
    const sw = ts * 0.7
    const gap = ts * 0.8
    const widths = entries.map((e) => sw + ts * 0.3 + measure(e.name, ts, font))
    const drawEntry = (e: (typeof entries)[number], x: number, baseline: number) => {
      if (e.line) page.line(x, baseline - ts * 0.33, x + sw, baseline - ts * 0.33, Math.max(1, ts * 0.15), e.color)
      else page.fillRect(x, baseline - sw, sw, sw, e.color)
      text(x + sw + ts * 0.3, baseline, e.name)
    }
    if (c.legend === 't' || c.legend === 'b') {
      // rows of entries, centred
      const rows: number[][] = [[]]
      let used = 0
      widths.forEach((w, i) => {
        if (rows[rows.length - 1].length && used + w > right - left) { rows.push([]); used = 0 }
        rows[rows.length - 1].push(i)
        used += w + gap
      })
      const lh = ts * 1.3
      let y = c.legend === 't' ? top : bottom - rows.length * lh
      for (const row of rows) {
        const total = row.reduce((n, i) => n + widths[i], 0) + gap * (row.length - 1)
        let x = (left + right) / 2 - total / 2
        for (const i of row) { drawEntry(entries[i], x, y + ts); x += widths[i] + gap }
        y += lh
      }
      if (c.legend === 't') top += rows.length * lh + pad / 2
      else bottom -= rows.length * lh + pad / 2
    } else {
      const lw = Math.min(Math.max(...widths), (right - left) * 0.4)
      const lh = ts * 1.5
      let y = (top + bottom) / 2 - (entries.length * lh) / 2
      const x = c.legend === 'r' ? right - lw : left
      for (const e of entries) { drawEntry(e, x, y + ts); y += lh }
      if (c.legend === 'r') right -= lw + pad
      else left += lw + pad
    }
  }

  if (round) drawRound(page, c, first, { x: left, y: top, w: right - left, h: bottom - top }, text, ts)
  else drawAxes(page, c, { x: left, y: top, w: right - left, h: bottom - top }, text, ts, font)
  page.restore()
}

type TextFn = (x: number, y: number, s: string, size?: number, align?: 'left' | 'center' | 'right', f?: FontSpec, color?: Rgb) => number

function drawRound(page: PageDraw, c: Chart, p: ChartPlot, b: Box, text: TextFn, ts: number) {
  const s = p.series[0]
  const vals = s.values.map((v) => Math.max(0, v ?? 0))
  const total = vals.reduce((a, v) => a + v, 0)
  if (!total || b.w <= 0 || b.h <= 0) return
  const r = Math.min(b.w, b.h) / 2
  const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2]
  const inner = p.kind === 'doughnut' ? r * p.hole : 0
  let a = (p.firstAngle * Math.PI) / 180
  vals.forEach((v, i) => {
    if (!v) return
    const a1 = a + (v / total) * Math.PI * 2
    const color = hexRgb(s.pointColors?.[i] ?? (p.vary ? shade(c.palette, i) : (s.color ?? c.palette[0])))
    page.path(slice(cx, cy, r, inner, a, a1), { fill: color, stroke: [255, 255, 255], width: Math.max(0.5, r / 150) })
    if (p.labels.value || p.labels.percent) {
      const mid = (a + a1) / 2
      const lr = inner ? (r + inner) / 2 : r * 0.65
      const label = p.labels.percent ? `${Math.round((v / total) * 100)}%` : formatValue(v, s.format)
      text(cx + lr * Math.sin(mid), cy - lr * Math.cos(mid) + ts * 0.35, label, ts, 'center', undefined, [255, 255, 255])
    }
    a = a1
  })
}

function drawAxes(page: PageDraw, c: Chart, b: Box, text: TextFn, ts: number, font: FontSpec) {
  const plots = c.plots.filter((p) => p.kind !== 'pie' && p.kind !== 'doughnut')
  const n = Math.max(1, c.categories.length)
  const horizontal = plots.some((p) => p.kind === 'bar' && p.horizontal)
  const scatter = plots.every((p) => p.kind === 'scatter')

  // each plot's values as drawn: running totals for stacked ones, shares for 100%
  const stacks = plots.map((p) => {
    const base = Array<number>(n).fill(0)
    const neg = Array<number>(n).fill(0)
    const sums = Array.from({ length: n }, (_, i) => p.series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0))
    return p.series.map((s) => Array.from({ length: n }, (_, i) => {
      let v = s.values[i] ?? 0
      if (p.grouping === 'percent') v = sums[i] ? v / sums[i] : 0
      if (p.grouping === 'clustered') return { lo: 0, hi: v, missing: s.values[i] == null }
      const at = v >= 0 ? base : neg
      const lo = at[i]
      at[i] += v
      return { lo, hi: at[i], missing: s.values[i] == null }
    }))
  })
  let lo = 0
  let hi = 0
  for (const st of stacks) for (const ser of st) for (const v of ser) if (!v.missing) { lo = Math.min(lo, v.lo, v.hi); hi = Math.max(hi, v.lo, v.hi) }
  if (scatter) {
    const ys = plots.flatMap((p) => p.series.flatMap((s) => s.values.filter((v): v is number => v != null)))
    if (ys.length) { lo = Math.min(0, ...ys); hi = Math.max(...ys) }
  }
  const percent = plots.some((p) => p.grouping === 'percent')
  const scale = niceScale(lo, percent ? Math.min(1, hi) : hi)
  const fmt = c.valueFormat ?? (percent ? '0%' : plots[0].series[0]?.format)
  const label = (v: number) => formatValue(Math.round(v / scale.step) * scale.step === v ? v : +v.toPrecision(10), fmt && !/^general$/i.test(fmt) ? fmt : undefined)
  const ticks: number[] = []
  for (let v = scale.min; v <= scale.max + scale.step * 1e-6; v += scale.step) ticks.push(+v.toPrecision(12))

  // room for the labels: value labels on the left (or below, for bars), category labels below (or on the left)
  const valW = Math.max(...ticks.map((t) => measure(label(t), ts, font)))
  const catLabels = scatter ? [] : c.categories
  const catW = Math.max(0, ...catLabels.map((t) => measure(t, ts, font)))
  const lh = ts * 1.3
  let { x, y, w, h } = b
  if (c.axisTitles.value) { if (horizontal) h -= lh; else { x += lh; w -= lh } }
  if (c.axisTitles.category) { if (horizontal) { x += lh; w -= lh } else h -= lh }
  if (horizontal) { x += catW + ts * 0.5; w -= catW + ts * 0.5; h -= lh } else { x += valW + ts * 0.5; w -= valW + ts * 0.5; h -= lh }
  if (w <= 4 || h <= 4) return
  if (c.axisTitles.value) {
    if (horizontal) text(x + w / 2, b.y + b.h - ts * 0.2, c.axisTitles.value, ts, 'center')
    else { page.save(); page.transform(0, -1, 1, 0, b.x + ts, y + h / 2); text(0, 0, c.axisTitles.value, ts, 'center'); page.restore() }
  }
  if (c.axisTitles.category) {
    if (horizontal) { page.save(); page.transform(0, -1, 1, 0, b.x + ts, y + h / 2); text(0, 0, c.axisTitles.category, ts, 'center'); page.restore() }
    else text(x + w / 2, b.y + b.h - ts * 0.2, c.axisTitles.category, ts, 'center')
  }

  // value to position along the value axis
  const span = scale.max - scale.min || 1
  const vpos = (v: number) => (horizontal ? x + ((v - scale.min) / span) * w : y + h - ((v - scale.min) / span) * h)
  for (const t of ticks) {
    const p = vpos(t)
    if (horizontal) {
      if (c.gridlines) page.line(p, y, p, y + h, 0.75, GRID)
      text(p, y + h + ts * 1.15, label(t), ts, 'center')
    } else {
      if (c.gridlines) page.line(x, p, x + w, p, 0.75, GRID)
      text(x - ts * 0.4, p + ts * 0.35, label(t), ts, 'right')
    }
  }

  if (scatter) return drawScatter(page, c, plots, { x, y, w, h }, vpos, text, ts)

  // categories: bands along the category axis; bar charts list the first category at the bottom, as Office does
  const band = (horizontal ? h : w) / n
  const bandStart = (i: number) => (horizontal ? y + h - (i + 1) * band : x + i * band)
  // where a line or area point of category i sits
  const at = (i: number) => (c.onTicks && n > 1 ? x + (i / (n - 1)) * w : bandStart(i) + band / 2)
  const zero = vpos(Math.max(scale.min, Math.min(scale.max, 0)))
  if (horizontal) page.line(zero, y, zero, y + h, 0.75, AXIS)
  else page.line(x, zero, x + w, zero, 0.75, AXIS)
  const every = Math.max(1, Math.ceil((catW + ts) / band)) // labels that would overlap are thinned out
  catLabels.forEach((t, i) => {
    if (i % every) return
    if (horizontal) text(x - ts * 0.4, bandStart(i) + band / 2 + ts * 0.35, t, ts, 'right')
    else text(c.onTicks && !horizontal ? at(i) : bandStart(i) + band / 2, y + h + ts * 1.15, t, ts, 'center')
  })

  let index = 0
  plots.forEach((p, pi) => {
    const st = stacks[pi]
    if (p.kind === 'bar') {
      const group = band / (1 + p.gap)
      const each = p.grouping === 'clustered' ? group / p.series.length : group
      p.series.forEach((s, si) => {
        const color = colorOf(c, s, index + si)
        st[si].forEach((v, i) => {
          if (v.missing) return
          const at = bandStart(i) + (band - group) / 2 + (p.grouping === 'clustered' ? (horizontal ? p.series.length - 1 - si : si) * each : 0)
          const [a, z] = [vpos(v.lo), vpos(v.hi)]
          const fill = s.pointColors?.[i] ? hexRgb(s.pointColors[i]) : p.vary && p.series.length === 1 ? hexRgb(shade(c.palette, i)) : color
          if (horizontal) page.fillRect(Math.min(a, z), at, Math.abs(z - a), each, fill)
          else page.fillRect(at, Math.min(a, z), each, Math.abs(z - a), fill)
          if (p.labels.value) {
            const lab = formatValue(s.values[i] ?? 0, s.format)
            if (horizontal) text(Math.max(a, z) + ts * 0.3, at + each / 2 + ts * 0.35, lab, ts * 0.9)
            else text(at + each / 2, Math.min(a, z) - ts * 0.3, lab, ts * 0.9, 'center')
          }
        })
      })
    } else {
      // lines and areas: points at the middle of each band; areas are drawn first so lines stay on top
      p.series.forEach((s, si) => {
        const color = colorOf(c, s, index + si)
        const pts = st[si].map((v, i) => (v.missing ? null : ([at(i), vpos(v.hi)] as [number, number])))
        if (p.kind === 'area') {
          const segs: Seg[] = []
          st[si].forEach((v, i) => segs.push([i ? 'L' : 'M', at(i), vpos(v.hi)]))
          for (let i = n - 1; i >= 0; i--) segs.push(['L', at(i), vpos(st[si][i].lo)])
          segs.push(['Z'])
          page.path(segs, { fill: color })
          return
        }
        if (s.line) {
          let segs: Seg[] = []
          for (const q of pts) {
            if (!q) { if (segs.length > 1) page.path(segs, { stroke: color, width: Math.max(1, ts * 0.22) }); segs = []; continue }
            segs.push([segs.length ? 'L' : 'M', q[0], q[1]])
          }
          if (segs.length > 1) page.path(segs, { stroke: color, width: Math.max(1, ts * 0.22) })
        }
        if (s.marker) for (const q of pts) if (q) page.path(slice(q[0], q[1], ts * 0.28, 0, 0, Math.PI * 2), { fill: color })
        if (p.labels.value) pts.forEach((q, i) => q && text(q[0], q[1] - ts * 0.5, formatValue(s.values[i] ?? 0, s.format), ts * 0.9, 'center'))
      })
    }
    index += p.series.length
  })
}

function drawScatter(page: PageDraw, c: Chart, plots: ChartPlot[], b: Box, vpos: (v: number) => number, text: TextFn, ts: number) {
  const xs = plots.flatMap((p) => p.series.flatMap((s) => (s.xs ?? s.values.map((_, i) => i + 1)).filter((v): v is number => v != null)))
  if (!xs.length) return
  const sx = niceScale(Math.min(0, ...xs), Math.max(...xs))
  const xpos = (v: number) => b.x + ((v - sx.min) / (sx.max - sx.min || 1)) * b.w
  for (let v = sx.min; v <= sx.max + sx.step * 1e-6; v += sx.step) {
    const t = +v.toPrecision(12)
    if (c.gridlines) page.line(xpos(t), b.y, xpos(t), b.y + b.h, 0.75, GRID)
    text(xpos(t), b.y + b.h + ts * 1.15, formatValue(t, undefined), ts, 'center')
  }
  page.line(b.x, b.y + b.h, b.x + b.w, b.y + b.h, 0.75, AXIS)
  let index = 0
  for (const p of plots) {
    p.series.forEach((s, si) => {
      const color = colorOf(c, s, index + si)
      const pts = s.values.map((v, i) => { const xv = s.xs?.[i] ?? i + 1; return v == null || xv == null ? null : ([xpos(xv), vpos(v)] as [number, number]) }).filter((q): q is [number, number] => !!q)
      if (s.line && pts.length > 1) page.path(pts.map((q, i) => [i ? 'L' : 'M', q[0], q[1]] as Seg), { stroke: color, width: Math.max(1, ts * 0.22) })
      if (s.marker) for (const q of pts) page.path(slice(q[0], q[1], ts * 0.28, 0, 0, Math.PI * 2), { fill: color })
    })
    index += p.series.length
  }
}
