import { describe, expect, test } from 'vitest'
import { pageBlocks, type PageChars, type TextChar, type TextBlock, type Table } from '../src/index.ts'

type Style = { size?: number; bold?: boolean; italic?: boolean; color?: [number, number, number]; kind?: 'sans' | 'serif' | 'mono'; face?: string }
/** a line of text at (x, y) in y-down points; each character is half an em wide */
function row(text: string, x: number, y: number, s: Style = {}): TextChar[] {
  const size = s.size ?? 10
  const w = size * 0.5
  return [...text].map((t, i) => ({ text: t, x0: x + i * w, y0: y, x1: x + (i + 1) * w, y1: y, size, bold: !!s.bold, italic: !!s.italic, angle: 0, invisible: false, kind: s.kind, face: s.face, color: s.color }))
}
const page = (chars: TextChar[], extra: Partial<PageChars> = {}): PageChars => ({ chars, width: 400, height: 600, shapes: { rules: [], fills: [], dots: [] }, pictures: [], ...extra })
const texts = (b: ReturnType<typeof pageBlocks>) => b.blocks.filter((x): x is TextBlock => x.kind === 'text')
const joined = (b: TextBlock) => b.runs.map((r) => r.text).join('')

describe('paragraph blocks', () => {
  test('lines of one paragraph join; a gap makes a new paragraph with space between; headings by size; margins from the content', () => {
    const chars = [
      ...row('A big title', 50, 60, { size: 24, bold: true }),
      ...row('first line of text', 50, 100), ...row('second line here', 50, 113),
      ...row('next paragraph', 50, 150), ...row('and its second line', 50, 163),
    ]
    const b = pageBlocks(page(chars), [])
    const [title, p1, p2] = texts(b)
    expect(title).toMatchObject({ heading: 1, size: 24 })
    expect(joined(p1)).toBe('first line of text second line here')
    expect(p1.lines).toBe(2)
    expect(p1.leading).toBe(13)
    expect(joined(p2)).toBe('next paragraph and its second line')
    // from the last baseline of p1 (113) to the first of p2 (150): 37, less one line of 13
    expect(p1.after).toBeCloseTo(24, 5)
    expect(b.margins.left).toBe(50)
    expect(b.margins.top).toBeCloseTo(60 - 24, 5)
  })

  test('runs keep bold, italic, size, colour and font; equal neighbours merge; a hyphen at a line end joins the word', () => {
    const chars = [
      ...row('plain ', 50, 100), ...row('bold', 80, 100, { bold: true, color: [200, 0, 0], kind: 'serif', face: 'Georgia' }), ...row(' tail', 100, 100),
      ...row('split-', 50, 113), ...row('ted word', 50, 126),
    ]
    const [p] = texts(pageBlocks(page(chars), []))
    expect(p.runs.map((r) => [r.text, r.bold])).toEqual([['plain ', false], ['bold', true], [' tail splitted word', false]])
    expect(p.runs[1]).toMatchObject({ color: [200, 0, 0], kind: 'serif', face: 'Georgia' })
  })

  test('alignment: centred, right and justified are told apart from left', () => {
    const body = [0, 1, 2, 3, 4, 5].flatMap((i) => row('body text that fills the width of the column nicely', 50, 100 + i * 13))
    const exactly = row('Centred', 200 - 17.5, 230)
    const right = row('Right', 350 - 25, 260)
    const wide = row('x'.repeat(60), 50, 290) // reaches 350: the column's right edge
    const b = texts(pageBlocks(page([...body, ...exactly, ...right, ...wide]), []))
    expect(b.find((x) => joined(x) === 'Centred')?.align).toBe('center')
    expect(b.find((x) => joined(x) === 'Right')?.align).toBe('right')
    expect(b.find((x) => joined(x).startsWith('xxx'))?.align).toBe('left')
  })

  test('indents: a first-line indent, a hanging bullet, and a bullet marker removed from the text', () => {
    const chars = [
      ...row('Indented first line of a paragraph that goes on', 62, 100), ...row('and wraps back to the margin of the page', 50, 113),
      ...row('• a bullet item that wraps onto', 50, 150), ...row('a second line under the text', 62, 163),
    ]
    const [p, bullet] = texts(pageBlocks(page(chars), []))
    expect(p).toMatchObject({ indentFirst: 12, indentLeft: 0 })
    expect(bullet.bullet).toBe(true)
    expect(joined(bullet)).toBe('a bullet item that wraps onto a second line under the text')
    expect(bullet.indentFirst).toBeLessThan(0)
  })
})

describe('bullets drawn as shapes', () => {
  test('a small mark level with the first line starts a bullet paragraph that hangs from it', () => {
    const chars = [...row('first item text', 62, 100), ...row('second item that wraps', 62, 113), ...row('onto a next line', 62, 126), ...row('third item', 62, 150)]
    const dot = (y: number) => ({ x0: 52, y0: y - 6, x1: 56, y1: y - 2, color: '#000' })
    const b = texts(pageBlocks(page(chars, { shapes: { rules: [], fills: [], dots: [dot(100), dot(113), dot(150)] } }), []))
    expect(b.map((x) => [x.bullet, joined(x)])).toEqual([[true, 'first item text'], [true, 'second item that wraps onto a next line'], [true, 'third item']])
    expect(b[0]).toMatchObject({ indentLeft: 0, indentFirst: -10 }) // the text starts at the left of the column; the mark hangs 10 points before it
  })
})

describe('tables and objects in the flow', () => {
  const table = (y0: number, y1: number): Table => ({
    x0: 50, y0, x1: 250, y1, rows: 1, cols: 2, xs: [50, 150, 250], ruled: true,
    cells: [{ row: 0, col: 0, rows: 1, cols: 1, text: 'a', bold: false, align: 'left', size: 10 }, { row: 0, col: 1, rows: 1, cols: 1, text: 'b', bold: false, align: 'left', size: 10 }],
  })

  test('text inside a table leaves the flow; text on both sides stays in separate paragraphs, in order', () => {
    const chars = [...row('before the table', 50, 80), ...row('a', 60, 130), ...row('b', 160, 130), ...row('after the table', 50, 240)]
    const b = pageBlocks(page(chars), [table(110, 150)])
    expect(b.blocks.map((x) => x.kind)).toEqual(['text', 'table', 'text'])
    expect(texts(b).map(joined)).toEqual(['before the table', 'after the table'])
  })

  test('a picture between lines ends the paragraph; one that covers the page is a background placed first', () => {
    const chars = [...row('above the picture', 50, 80), ...row('below the picture', 50, 220)]
    const img = {} as never
    const b = pageBlocks(page(chars, { pictures: [{ image: img, x0: 50, y0: 100, x1: 150, y1: 180 }, { image: img, x0: 0, y0: 0, x1: 400, y1: 600 }] }), [])
    expect(b.blocks.map((x) => x.kind === 'picture' ? (x.background ? 'bg' : 'pic') : x.kind)).toEqual(['bg', 'text', 'pic', 'text'])
  })

  test('invisible text (a scan layer) is not content; an empty page still gets margins', () => {
    const hidden = row('searchable layer', 50, 100).map((c) => ({ ...c, invisible: true }))
    const b = pageBlocks(page(hidden), [])
    expect(b.blocks).toEqual([])
    expect(b.margins).toEqual({ top: 36, left: 36, right: 36, bottom: 36 })
  })
})
