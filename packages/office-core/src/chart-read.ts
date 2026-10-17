// Charts (c:chartSpace parts of .pptx and .xlsx) as plain data, from the values the file keeps with each chart, so they
// can be drawn without a spreadsheet engine. Bar and column, line, area, pie, doughnut and scatter charts are read; 3D
// variants are read as flat ones. Radar, bubble, stock and surface charts are not (the caller keeps a marked gap).
import { resolveColor, type ColorContext } from './drawingml.ts'
import { formatValue } from './numfmt.ts'
import { child, dig, kids, num, type XmlNode } from './xml.ts'

export type ChartKind = 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter'

export type ChartSeries = {
  name: string
  values: (number | null)[]
  /** scatter: the x of each point */
  xs?: (number | null)[]
  /** RRGGBB; absent: the theme's accent for the series' place */
  color?: string
  /** line and scatter: the line between points is drawn */
  line: boolean
  marker: boolean
  /** pie and doughnut, and bars that vary by point: a colour per point */
  pointColors?: (string | undefined)[]
  /** the number format of the values */
  format?: string
}

export type ChartPlot = {
  kind: ChartKind
  /** bars running left to right (a bar chart) rather than up (a column chart) */
  horizontal: boolean
  grouping: 'clustered' | 'stacked' | 'percent'
  series: ChartSeries[]
  /** space between groups of bars, as a fraction of a bar's width */
  gap: number
  /** doughnut hole, fraction of the radius */
  hole: number
  /** pie: where the first slice starts, degrees clockwise from the top */
  firstAngle: number
  labels: { value: boolean; percent: boolean }
  /** one colour per point (pies by default) */
  vary: boolean
}

export type Chart = {
  title?: string
  legend?: 't' | 'b' | 'l' | 'r'
  /** category names along the axis (or of the slices) */
  categories: string[]
  /** a chart can combine kinds (columns with a line); they share the axes */
  plots: ChartPlot[]
  /** points */
  textSize: number
  textColor?: string
  font?: string
  /** the value axis' number format, when it has its own */
  valueFormat?: string
  gridlines: boolean
  /** points sit on the category axis' ticks, first and last at the ends (area charts by default), not in the middle of each band */
  onTicks: boolean
  axisTitles: { category?: string; value?: string }
  /** the accent colours series take in turn */
  palette: string[]
  /** the chart area's fill and outline: a colour, null for none, absent for the program's default */
  area: { fill?: string | null; line?: string | null }
}

const KINDS: Record<string, ChartKind> = {
  barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line', areaChart: 'area', area3DChart: 'area', pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie', doughnutChart: 'doughnut', scatterChart: 'scatter',
}
const MAX_POINTS = 10_000

const val = (n: XmlNode | undefined) => n?.attrs.val

/** the cells a reference like 'Sheet 1'!$B$2:$B$6 names, for charts saved without their values (as openpyxl does) */
export type ChartLookup = (ref: string) => { values: string[]; format?: string } | null

/** the cached points of a numRef/strRef/numLit/strLit, by index; else the cells the reference names */
function points(holder: XmlNode | undefined, lookup?: ChartLookup): { values: string[]; format?: string } {
  const cache = holder && (dig(holder, 'numRef', 'numCache') ?? dig(holder, 'strRef', 'strCache') ?? child(holder, 'numLit') ?? child(holder, 'strLit') ?? dig(holder, 'multiLvlStrRef', 'multiLvlStrCache', 'lvl'))
  if (!cache) {
    const f = dig(holder, 'numRef', 'f') ?? dig(holder, 'strRef', 'f')
    return (f && lookup?.(f.text)) || { values: [] }
  }
  const count = Math.min(MAX_POINTS, num(child(cache, 'ptCount'), 'val', 0))
  const values: string[] = Array(count).fill('')
  for (const p of kids(cache, 'pt')) {
    const i = num(p, 'idx', -1)
    if (i >= 0 && i < MAX_POINTS) values[i] = child(p, 'v')?.text ?? ''
  }
  return { values, format: child(cache, 'formatCode')?.text }
}

const numbers = (holder: XmlNode | undefined, lookup?: ChartLookup) => {
  const p = points(holder, lookup)
  return { values: p.values.map((v) => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v))), format: p.format }
}

/** the text of a title or series name: rich text runs, a cached reference, or a plain value */
function textOf(tx: XmlNode | undefined, lookup?: ChartLookup): string | undefined {
  if (!tx) return undefined
  const rich = child(tx, 'rich')
  if (rich) return kids(rich, 'p').map((p) => kids(p, 'r').map((r) => child(r, 't')?.text ?? '').join('')).join('\n') || undefined
  const ref = points(tx, lookup).values
  if (ref.length) return ref.join(' ')
  return child(tx, 'v')?.text
}

const colorIn = (holder: XmlNode | undefined, colors: ColorContext) => (holder ? resolveColor(holder, colors)?.hex : undefined)

function areaOf(sp: XmlNode | undefined, colors: ColorContext): Chart['area'] {
  const out: Chart['area'] = {}
  if (child(sp, 'noFill')) out.fill = null
  else if (child(sp, 'solidFill')) out.fill = colorIn(child(sp, 'solidFill'), colors)
  const ln = child(sp, 'ln')
  if (child(ln, 'noFill')) out.line = null
  else if (child(ln, 'solidFill')) out.line = colorIn(child(ln, 'solidFill'), colors)
  return out
}

/** a chart part's root (chartSpace), or null when it holds no kind of chart we draw */
export function readChart(root: XmlNode | undefined, colors: ColorContext, lookup?: ChartLookup): Chart | null {
  const chart = child(root, 'chart')
  const area = child(chart, 'plotArea')
  if (!chart || !area) return null
  const accents = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((a) => colors.theme.colors[a]).filter(Boolean)
  const plots: ChartPlot[] = []
  let categories: string[] = []
  for (const g of area.children) {
    const kind = KINDS[g.name]
    if (!kind) continue
    const markersOn = val(child(g, 'marker')) !== '0' && val(child(g, 'marker')) !== 'false'
    const scatterStyle = val(child(g, 'scatterStyle')) ?? 'marker'
    const series: ChartSeries[] = []
    for (const s of kids(g, 'ser')) {
      const sp = child(s, 'spPr')
      const ln = child(sp, 'ln')
      const lineFill = child(ln, 'solidFill')
      const fill = child(sp, 'solidFill') ?? child(sp, 'gradFill')?.children.find((c) => c.name === 'gsLst')?.children[0]
      const lineOff = !!child(ln, 'noFill')
      const ys = numbers(child(s, kind === 'scatter' ? 'yVal' : 'val'), lookup)
      const cat = points(child(s, kind === 'scatter' ? 'xVal' : 'cat'), lookup)
      if (kind !== 'scatter' && cat.values.length && !categories.length) categories = cat.values.map((v) => (cat.format && v !== '' && Number.isFinite(Number(v)) ? formatValue(Number(v), cat.format) : v))
      const symbol = val(dig(s, 'marker', 'symbol'))
      const pointColors: (string | undefined)[] = []
      for (const d of kids(s, 'dPt')) pointColors[num(child(d, 'idx'), 'val', 0)] = colorIn(child(child(d, 'spPr'), 'solidFill'), colors)
      series.push({
        name: textOf(child(s, 'tx'), lookup) ?? `Series ${series.length + 1}`,
        values: ys.values,
        xs: kind === 'scatter' ? numbers(child(s, 'xVal'), lookup).values : undefined,
        color: kind === 'line' || kind === 'scatter' ? (colorIn(lineFill, colors) ?? colorIn(fill, colors)) : (colorIn(fill, colors) ?? colorIn(lineFill, colors)),
        line: kind === 'scatter' ? !lineOff && scatterStyle !== 'marker' && scatterStyle !== 'none' : !lineOff,
        marker: symbol ? symbol !== 'none' : kind === 'scatter' ? true : kind === 'line' && markersOn,
        pointColors: pointColors.length ? pointColors : undefined,
        format: ys.format,
      })
    }
    if (!series.length) continue
    const grouping = val(child(g, 'grouping'))
    const labels = dig(g, 'dLbls')
    const on = (n: XmlNode | undefined) => val(n) === '1' || val(n) === 'true'
    plots.push({
      kind,
      horizontal: val(child(g, 'barDir')) === 'bar',
      grouping: grouping === 'stacked' ? 'stacked' : grouping === 'percentStacked' ? 'percent' : 'clustered',
      series,
      gap: num(child(g, 'gapWidth'), 'val', 150) / 100,
      hole: Math.min(0.9, Math.max(0.1, num(child(g, 'holeSize'), 'val', 50) / 100)),
      firstAngle: num(child(g, 'firstSliceAng'), 'val', 0),
      labels: { value: on(child(labels, 'showVal')) || kids(g, 'ser').some((s) => on(dig(s, 'dLbls', 'showVal'))), percent: on(child(labels, 'showPercent')) || kids(g, 'ser').some((s) => on(dig(s, 'dLbls', 'showPercent'))) },
      vary: val(child(g, 'varyColors')) !== undefined ? val(child(g, 'varyColors')) === '1' || val(child(g, 'varyColors')) === 'true' : kind === 'pie' || kind === 'doughnut',
    })
  }
  if (!plots.length) return null
  if (!categories.length) categories = Array.from({ length: Math.max(...plots.flatMap((p) => p.series.map((s) => s.values.length))) }, (_, i) => String(i + 1))

  const titleNode = child(chart, 'title')
  const deleted = val(child(chart, 'autoTitleDeleted')) === '1'
  const allSeries = plots.flatMap((p) => p.series)
  const title = titleNode && !deleted ? (textOf(child(titleNode, 'tx')) ?? (allSeries.length === 1 ? allSeries[0].name : undefined)) : undefined
  const legendPos = val(dig(chart, 'legend', 'legendPos'))
  const valAx = child(area, 'valAx')
  const catAx = child(area, 'catAx') ?? child(area, 'dateAx')
  const defRPr = dig(root, 'txPr', 'p', 'pPr', 'defRPr')
  const fmt = dig(valAx, 'numFmt')
  return {
    title,
    legend: child(chart, 'legend') ? ((['t', 'b', 'l', 'r'] as const).find((p) => p === legendPos) ?? 'r') : undefined,
    categories,
    plots,
    textSize: defRPr?.attrs.sz ? num(defRPr, 'sz') / 100 : 10,
    textColor: colorIn(child(defRPr, 'solidFill'), colors),
    font: child(defRPr, 'latin')?.attrs.typeface,
    valueFormat: fmt && fmt.attrs.sourceLinked !== '1' && fmt.attrs.formatCode !== 'General' ? fmt.attrs.formatCode : undefined,
    gridlines: !!child(valAx, 'majorGridlines') || (!valAx && plots.some((p) => p.kind === 'scatter')),
    onTicks: val(child(valAx, 'crossBetween')) === 'midCat',
    axisTitles: { category: textOf(dig(catAx, 'title', 'tx')), value: textOf(dig(valAx, 'title', 'tx')) },
    palette: accents.length ? accents : ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'],
    area: areaOf(child(root, 'spPr'), colors),
  }
}
