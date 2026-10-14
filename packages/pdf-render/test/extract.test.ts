import { describe, expect, test } from 'vitest'
import { PdfDocument } from '@ream/pdf-core'
import { extractText, layoutPage, type TextChar } from '../src/index.ts'
import { assemble } from '../../pdf-core/test/helpers.ts'

type Style = { size?: number; bold?: boolean; italic?: boolean; angle?: number }
/** a line of text starting at (x, y) in y-down points; each character is half an em wide; a space before a word is a real character unless `bare` */
function row(text: string, x: number, y: number, s: Style = {}): TextChar[] {
  const size = s.size ?? 12
  const w = size * 0.5
  return [...text].map((t, i) => ({ text: t, x0: x + i * w, y0: y, x1: x + (i + 1) * w, y1: y, size, bold: !!s.bold, italic: !!s.italic, angle: 0, invisible: false }))
}
/** words separated by a gap but no space character, like many PDFs */
function gapped(words: string[], x: number, y: number, size = 12, gapEm = 0.3): TextChar[] {
  let at = x
  return words.flatMap((w) => {
    const cs = row(w, at, y, { size })
    at += w.length * size * 0.5 + gapEm * size
    return cs
  })
}
const text = (chars: TextChar[], markdown = false, bodySize?: number) => layoutPage(chars, { markdown, bodySize })

describe('layoutPage: plain text', () => {
  test('a line, in reading order whatever order the file drew it in', () => {
    expect(text([...row('World', 106, 50), ...row('Hello ', 70, 50)])).toBe('Hello World')
    expect(text([...row('Second line', 50, 80), ...row('First line', 50, 50)])).toBe('First line\nSecond line')
  })

  test('words are found from gaps when there are no space characters', () => {
    expect(text(gapped(['quick', 'brown', 'fox'], 50, 50))).toBe('quick brown fox')
    expect(text(gapped(['tight', 'kerning'], 50, 50, 12, 0.05))).toBe('tightkerning') // a gap that small is kerning
  })

  test('paragraphs are separated by a blank line where the line spacing jumps', () => {
    const lines = [...row('one a', 50, 50), ...row('one b', 50, 64), ...row('two a', 50, 92), ...row('two b', 50, 106)]
    expect(text(lines)).toBe('one a\none b\n\ntwo a\ntwo b')
  })

  test('a raised letter stays on its line; the same letter printed twice counts once', () => {
    const sup = row('x', 50, 50).concat(row('2', 56, 46, { size: 8 }))
    expect(text(sup)).toBe('x2')
    expect(text([...row('Bold', 50, 50), ...row('Bold', 50.5, 50)])).toBe('Bold')
  })

  test('two columns are read one after the other', () => {
    const left = [0, 1, 2, 3, 4, 5].flatMap((i) => row(`left line ${i}`, 50, 50 + i * 14))
    const right = [0, 1, 2, 3, 4, 5].flatMap((i) => row(`right line ${i}`, 350, 50 + i * 14))
    const out = text([...right, ...left]) // the file draws the right column first
    expect(out.indexOf('left line 5')).toBeLessThan(out.indexOf('right line 0'))
    expect(out.split('\n\n')).toHaveLength(2)
  })

  test('ligatures are spelled out, odd spaces and zero width characters tidied', () => {
    expect(text(row('ﬁnal of​ ﬂow', 50, 50))).toBe('final of flow')
  })

  test('a page shown rotated is read the way the text runs', () => {
    // text running top to bottom (angle 90): x is fixed, y grows
    const down = [...'Hello world'].map((t, i): TextChar => ({ text: t, x0: 100, y0: 50 + i * 6, x1: 100, y1: 56 + i * 6, size: 12, bold: false, italic: false, angle: 90, invisible: false }))
    expect(text(down)).toBe('Hello world')
  })

  test('invisible text (a scanned page with a text layer) is included', () => {
    expect(text(row('scanned', 50, 50).map((c) => ({ ...c, invisible: true })))).toBe('scanned')
  })
})

describe('layoutPage: Markdown', () => {
  test('headings by size, bullets, bold and italic runs, joined lines, split words rejoined', () => {
    const chars = [
      ...row('Annual report', 50, 60, { size: 24 }),
      ...row('This paragraph is wrapped with a split inter-', 50, 100),
      ...row('national word and goes on.', 50, 114),
      ...row('• first item', 50, 140),
      ...row('• second item', 50, 154),
      ...row('plain ', 50, 180), ...row('strong', 50 + 6 * 6, 180, { bold: true }), ...row(' text', 50 + 12 * 6, 180),
    ]
    const out = text(chars, true, 12)
    expect(out.split('\n\n')).toEqual([
      '# Annual report',
      'This paragraph is wrapped with a split international word and goes on.',
      '- first item',
      '- second item',
      'plain **strong** text',
    ])
  })

  test('heading levels follow the size, text that needs it is escaped', () => {
    expect(text(row('Big', 50, 50, { size: 30 }), true, 12)).toBe('# Big')
    expect(text(row('Mid', 50, 50, { size: 18 }), true, 12)).toBe('## Mid')
    expect(text(row('Small', 50, 50, { size: 14 }), true, 12)).toBe('### Small')
    expect(text(row('a*b_c', 50, 50), true, 12)).toBe('a\\*b\\_c')
    expect(text(row('# not a heading', 50, 50), true, 12)).toBe('\\# not a heading')
  })
})

describe('extractText on a real file', () => {
  const doc = async (content: string, extra = '') =>
    PdfDocument.load(
      assemble([
        [1, '<< /Type /Catalog /Pages 2 0 R >>'],
        [2, '<< /Type /Pages /Kids [4 0 R] /Count 1 >>'],
        [3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
        [4, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] ${extra} /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>`],
        [5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
      ]).bytes,
    )

  test('lines from separate text operators come out top to bottom', async () => {
    const d = await doc('BT /F1 12 Tf 20 100 Td (Second line here) Tj ET BT /F1 12 Tf 20 250 Td (First line here) Tj 0 -14 Td (Still first block) Tj ET')
    expect((await extractText(d, [0], { markdown: false }))[0]).toBe('First line here\nStill first block\n\nSecond line here')
  })

  test('TJ kerning numbers make word breaks', async () => {
    const d = await doc('BT /F1 12 Tf 20 250 Td [(Hello) -500 (World) -30 (again)] TJ ET')
    expect((await extractText(d, [0], { markdown: false }))[0]).toBe('Hello World again'.replace('World again', 'Worldagain'))
  })

  test('a rotated page reads the same text', async () => {
    const d = await doc('BT /F1 12 Tf 20 250 Td (Turned page text) Tj ET', '/Rotate 90')
    expect((await extractText(d, [0], { markdown: false }))[0]).toBe('Turned page text')
  })

  test('a page with no text gives nothing', async () => {
    expect((await extractText(await doc('0 0 10 10 re f'), [0], { markdown: true }))[0]).toBe('')
  })
})
