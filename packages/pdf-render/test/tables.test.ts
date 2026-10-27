import { describe, expect, test } from 'vitest'
import { textWidth } from '@ream/pdf-core'
import { findTables, pageChars, type Table } from '../src/index.ts'
import { ShapeRecorder } from '../src/shapes.ts'
import { onePage } from './helpers.ts'

const FONT = '/Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >>'
const t = (x: number, y: number, s: string, font = 'F1', size = 10) => `BT /${font} ${size} Tf ${x} ${y} Td (${s}) Tj ET\n`
const line = (x0: number, y0: number, x1: number, y1: number) => `0.5 w ${x0} ${y0} m ${x1} ${y1} l S\n`
const find = async (content: string, pageExtra = '') => findTables(await pageChars(await onePage({ content, resources: FONT, box: '[0 0 300 300]', pageExtra }), 0))
const grid = (tb: Table) => {
  const out: string[][] = Array.from({ length: tb.rows }, () => Array(tb.cols).fill(''))
  for (const c of tb.cells) out[c.row][c.col] = c.text
  return out
}

/** a 3 x 3 grid, columns at x = 50 120 190 260, rows at y = 250 230 210 190; `skip` leaves out one vertical segment */
function ruled(skipMiddleRight = false) {
  let c = ''
  for (const y of [250, 230, 210, 190]) c += line(50, y, 260, y)
  for (const x of [50, 120, 190, 260]) {
    if (skipMiddleRight && x === 190) c += line(x, 250, x, 230) + line(x, 210, x, 190)
    else c += line(x, 250, x, 190)
  }
  const cell = (r: number, col: number, s: string, font = 'F1') => t(55 + col * 70, 250 - r * 20 - 14, s, font)
  c += cell(0, 0, 'Item', 'F2') + cell(0, 1, 'Qty', 'F2') + cell(0, 2, 'Price', 'F2')
  c += cell(1, 0, 'Tea') + (skipMiddleRight ? cell(1, 1, 'two cells wide') : cell(1, 1, '2') + cell(1, 2, '3.50'))
  c += cell(2, 0, 'Milk') + cell(2, 1, '1') + cell(2, 2, '0.99')
  return c
}

describe('shape recording', () => {
  test('thin filled boxes and strokes become rules; slanted lines and curves do not; transforms apply', () => {
    const r = new ShapeRecorder()
    r.fillStyle = 'rgb(0,0,0)'
    r.rect(10, 20, 100, 0.5)
    r.fill()
    r.beginPath()
    r.rect(10, 20, 4, 40)
    r.fill()
    expect(r.shapes.rules).toHaveLength(1) // the 4 x 40 box is a fill, not a rule
    expect(r.shapes.fills).toHaveLength(1)
    expect(r.shapes.rules[0]).toMatchObject({ x0: 10, x1: 110 })
    r.beginPath()
    r.moveTo(0, 0); r.lineTo(30, 30); r.stroke() // slanted
    r.beginPath()
    r.moveTo(0, 0); r.bezierCurveTo(5, 5, 10, 10, 20, 0); r.stroke() // a curve
    expect(r.shapes.rules).toHaveLength(1)
    r.save()
    r.setTransform(2, 0, 0, 2, 100, 0)
    r.lineWidth = 1
    r.beginPath()
    r.rect(0, 0, 10, 10)
    r.stroke() // four sides, doubled and moved
    r.restore()
    const sides = r.shapes.rules.slice(1)
    expect(sides).toHaveLength(4)
    expect(sides.every((s) => s.width === 2)).toBe(true)
    // a small square or round filled mark is a possible bullet
    r.beginPath()
    r.rect(0, 0, 4, 4)
    r.fill()
    r.beginPath()
    r.moveTo(0, 0); r.bezierCurveTo(2, 0, 4, 2, 4, 4); r.bezierCurveTo(2, 4, 0, 2, 0, 0); r.fill()
    r.beginPath()
    r.rect(0, 0, 40, 40)
    r.fill() // too big to be one
    expect(r.shapes.dots).toHaveLength(2)
    expect(Math.min(...sides.map((s) => s.x0))).toBe(100)
    expect(Math.max(...sides.map((s) => s.x1))).toBe(120)
  })
})

describe('ruled tables', () => {
  test('a grid drawn with lines: cells, text, bold header', async () => {
    const tables = await find(ruled())
    expect(tables).toHaveLength(1)
    expect(tables[0]).toMatchObject({ ruled: true, rows: 3, cols: 3 })
    expect(grid(tables[0])).toEqual([['Item', 'Qty', 'Price'], ['Tea', '2', '3.50'], ['Milk', '1', '0.99']])
    expect(tables[0].cells.filter((c) => c.bold).map((c) => c.text)).toEqual(['Item', 'Qty', 'Price'])
  })

  test('a missing line joins two cells', async () => {
    const [tb] = await find(ruled(true))
    expect(tb.cells.find((c) => c.row === 1 && c.col === 1)).toMatchObject({ cols: 2, text: 'two cells wide' })
    expect(tb.cells).toHaveLength(8)
  })

  test('the same grid on a page shown rotated reads the same', async () => {
    const [tb] = await find(ruled(), '/Rotate 90')
    expect(tb).toMatchObject({ ruled: true, rows: 3, cols: 3 })
    expect(grid(tb)).toEqual([['Item', 'Qty', 'Price'], ['Tea', '2', '3.50'], ['Milk', '1', '0.99']])
  })

  test('a lone box around a paragraph is not a table', async () => {
    const c = line(40, 250, 260, 250) + line(40, 150, 260, 150) + line(40, 250, 40, 150) + line(260, 250, 260, 150) + t(50, 235, 'Just a framed note of text.') + t(50, 220, 'Second line of the note.')
    expect(await find(c)).toEqual([])
  })

  test('only a top and a bottom line with column lines: rows are the text lines', async () => {
    let c = line(50, 250, 260, 250) + line(50, 190, 260, 190)
    for (const x of [50, 150, 260]) c += line(x, 250, x, 190)
    for (const [i, [a, b]] of [['Name', 'City'], ['Ann', 'Oslo'], ['Bo', 'Rome']].entries()) c += t(55, 238 - i * 16, a) + t(155, 238 - i * 16, b)
    const [tb] = await find(c)
    expect(grid(tb)).toEqual([['Name', 'City'], ['Ann', 'Oslo'], ['Bo', 'Rome']])
  })
})

describe('tables from aligned text', () => {
  const money = (right: number, y: number, s: string) => t(right - textWidth(s, 10), y, s)
  const page = () =>
    t(50, 270, 'A paragraph of ordinary text above the table that runs the whole width of the page.') +
    t(50, 240, 'Item', 'F2') + money(260, 240, 'Amount') +
    t(50, 224, 'Tea') + money(260, 224, '1,234.50') +
    t(50, 208, 'Milk') + money(260, 208, '99.00') +
    t(50, 192, 'Bread loaf') + money(260, 192, '3.20') +
    t(50, 160, 'A closing sentence of ordinary text that comes after the table ends.')

  test('columns found from where text lines up; the prose around it is left out', async () => {
    const tables = await find(page())
    expect(tables).toHaveLength(1)
    expect(tables[0]).toMatchObject({ ruled: false, rows: 4, cols: 2 })
    expect(grid(tables[0])).toEqual([['Item', 'Amount'], ['Tea', '1,234.50'], ['Milk', '99.00'], ['Bread loaf', '3.20']])
    // the numbers' column is right-aligned: its body cells say so even though the header is shorter
    expect(tables[0].cells.filter((c) => c.col === 1).map((c) => c.align)).toEqual(['right', 'right', 'right', 'right'])
  })

  test('a title above is not part of the table; a one-piece row inside it spans the columns', async () => {
    const above = t(50, 262, 'Order summary for March', 'F2') + t(50, 246, 'Item', 'F2') + money(260, 246, 'Amount')
    const c = above + t(50, 230, 'Dairy products listed below in alphabetical order', 'F2') + t(50, 214, 'Tea') + money(260, 214, '1.50') + t(50, 198, 'Milk') + money(260, 198, '0.99')
    const [tb] = await find(c)
    expect(tb.rows).toBe(4)
    expect(grid(tb).flat()).not.toContain('Order summary for March')
    expect(tb.cells.find((x) => x.text.startsWith('Dairy'))).toMatchObject({ row: 1, col: 0, cols: 2 })
  })

  test('plain paragraphs give no table, and two rows are too few', async () => {
    let c = ''
    for (let i = 0; i < 8; i++) c += t(50, 260 - i * 14, `Line ${i} of a paragraph with no wide gaps between its words at all.`)
    expect(await find(c)).toEqual([])
    // two columns of running text are not a two-column table
    let cols = ''
    for (let i = 0; i < 8; i++) cols += t(40, 260 - i * 12, `left column words that run on line ${i}`) + t(170, 260 - i * 12, `right column words that run on line ${i}`)
    expect(await find(cols)).toEqual([])
    expect(await find(t(50, 200, 'Left') + t(200, 200, 'Right') + t(50, 186, 'Left') + t(200, 186, 'Right'))).toEqual([])
  })
})
