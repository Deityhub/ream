import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { readPptx, readXlsx, type SlideChart } from '../src/index.ts'

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)))

// charts.pptx (python-pptx): a stacked bar chart with a title and a legend below, then a doughnut showing percentages
test('charts in a deck are read from the values they keep', async () => {
  const [s1, s2] = (await readPptx(fixture('charts.pptx'))).slides
  const bar = s1.shapes.find((s) => s.kind === 'chart') as SlideChart
  expect(bar).toMatchObject({ x: 72, y: 72, w: 576, h: 360 })
  const c = bar.chart
  expect(c).toMatchObject({ title: 'Sales by region', legend: 'b', categories: ['North', 'South', 'East'] })
  expect(c.plots).toHaveLength(1)
  expect(c.plots[0]).toMatchObject({ kind: 'bar', horizontal: true, grouping: 'stacked' })
  expect(c.plots[0].series.map((s) => [s.name, s.values])).toEqual([['2024', [120, 95, 140]], ['2025', [150, 100, 165]]])
  expect(c.palette[0]).toMatch(/^[0-9A-F]{6}$/)
  const ring = (s2.shapes.find((s) => s.kind === 'chart') as SlideChart).chart.plots[0]
  expect(ring).toMatchObject({ kind: 'doughnut', vary: true, labels: { percent: true, value: false } })
  expect(ring.series[0].values).toEqual([75, 25])
})

// charts.xlsx (openpyxl): a line chart saved with only references to the cells, no values of its own
test('a sheet chart without saved values takes them from the cells it names', async () => {
  const sh = (await readXlsx(fixture('charts.xlsx'))).sheets[0]
  expect(sh.charts).toHaveLength(1)
  expect(sh.page?.saved).toBe(false) // only the margins every file has: no page setup to follow
  const { chart, from } = sh.charts![0]
  expect(from).toMatchObject({ col: 3, row: 1 })
  expect(chart).toMatchObject({ title: 'Traffic', categories: ['Jan', 'Feb', 'Mar'], legend: 'r', gridlines: true })
  expect(chart.plots[0].series[0]).toMatchObject({ name: 'Visitors', values: [30, 42, 38], marker: false, line: true })
})
