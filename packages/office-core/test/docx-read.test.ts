import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { readDocx, type DocBlock, type Paragraph } from '../src/index.ts'

// report.docx (python-docx, its default template): a title, mixed runs, a centred line, bullets, a numbered list, a grid
// table, a picture, a page break and a heading on the second page
test('a Word document reads with styles resolved: sizes and colours from the style chain, list markers, a table, a picture', async () => {
  const [s] = (await readDocx(new Uint8Array(readFileSync(new URL('./fixtures/report.docx', import.meta.url))))).sections
  expect([s.width, s.height]).toEqual([612, 792])
  const paras = s.blocks.filter((b): b is Paragraph => b.kind === 'p' && b.runs.length > 0)
  const text = (p: Paragraph) => p.runs.map((r) => r.text).join('')
  expect(paras.map(text)).toEqual(['Annual report', 'Plain text, bold red and more.', 'Centred line', 'First point', 'Second point', 'Step one', 'Step two', 'Second page', 'Closing words.'])
  // the Title style: 26 pt in the theme's dark blue
  expect(paras[0].runs[0]).toMatchObject({ size: 26, color: '17365D' })
  expect(paras[1].runs[1]).toMatchObject({ text: 'bold red', bold: true, color: 'C00000' })
  expect(paras[2].align).toBe('center')
  expect(paras.slice(3, 7).map((p) => p.marker)).toEqual(['•', '•', '1.', '2.'])
  const table = s.blocks.find((b) => b.kind === 'table') as Extract<DocBlock, { kind: 'table' }>
  expect(table.rows.map((r) => r.map((c) => c.paragraphs.map(text).join('')))).toEqual([['Item', 'Price'], ['Tea', '4.50']])
  expect(s.blocks.find((b) => b.kind === 'picture')).toMatchObject({ type: 'png', width: 144, height: 72 })
  const breakAt = s.blocks.findIndex((b) => b.kind === 'p' && b.pageBreakBefore)
  expect(breakAt).toBeGreaterThan(s.blocks.findIndex((b) => b.kind === 'picture'))
})
