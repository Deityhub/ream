import { describe, expect, test } from 'vitest'
import { placedBlocks, type PageChars, type TextChar, type TextBlock } from '../src/index.ts'

/** a line of text at (x, y) in y-down points; each character is half an em wide */
function row(text: string, x: number, y: number, size = 10, face?: string): TextChar[] {
  const w = size * 0.5
  return [...text].map((t, i) => ({ text: t, x0: x + i * w, y0: y, x1: x + (i + 1) * w, y1: y, size, bold: false, italic: false, angle: 0, invisible: false, face, color: [0, 0, 0] as [number, number, number] }))
}
const page = (chars: TextChar[], extra: Partial<PageChars> = {}): PageChars => ({ chars, width: 960, height: 540, shapes: { rules: [], fills: [], dots: [] }, pictures: [], ...extra })
const text = (b: TextBlock) => b.runs.map((r) => r.text).join('')

describe('text placed where it is', () => {
  // the slide that went wrong: a big two-line title on the left, between the lines of a smaller column on the right.
  // Joining characters by height chained them all into one line and mixed their letters.
  test('a big title beside a column of smaller lines stays apart from them, letter for letter', () => {
    const chars = [
      ...row('Encourage questions', 450, 270, 22), ...row('responses to enhance', 470, 294, 22),
      ...row('Engaging', 80, 262, 44), ...row('the audience', 80, 308, 44),
    ]
    const blocks = placedBlocks(page(chars))
    expect(blocks.map(text).sort()).toEqual(['Encourage questions', 'Engaging\nthe audience', 'responses to enhance'].sort())
    expect(blocks.find((b) => text(b).startsWith('Engaging'))).toMatchObject({ x0: 80, size: 44, lines: 2 })
  })

  test('one-line items one line apart stay separate lines; a bullet with no space after it hangs, and its wrapped line joins it', () => {
    const items = [...row('Introduction', 480, 240, 24), ...row('Building confidence', 480, 276, 24), ...row('Visual aids', 480, 312, 24)]
    const [list] = placedBlocks(page(items))
    expect(text(list)).toBe('Introduction\nBuilding confidence\nVisual aids')
    expect(list.breaks).toBe(true)

    const bullets = [
      ...row('•', 450, 120, 22), ...row('Make eye contact with', 468, 120, 22), ...row('your audience', 468, 144, 22),
      ...row('•', 450, 184, 22), ...row('Weave stories', 468, 184, 22),
    ]
    const [a, b] = placedBlocks(page(bullets))
    expect(text(a)).toBe('Make eye contact with\nyour audience')
    expect(a).toMatchObject({ x0: 450, indentLeft: 18, indentFirst: -18, mark: { text: '•', size: 22 } })
    expect(text(b)).toBe('Weave stories')
    // numbered items each start their own block
    const numbered = placedBlocks(page([...row('1. Know your material', 80, 60, 24), ...row('2. Anticipate questions', 80, 97, 24)]))
    expect(numbered.map(text)).toEqual(['1. Know your material', '2. Anticipate questions'])
  })

  test('alignment from the edges: a centred title, and a single line centred under it', () => {
    const blocks = placedBlocks(page([...row('Overcoming', 195, 180, 44), ...row('nervousness!', 173, 228, 44), ...row('Mirjam Nilsson', 221, 330, 24)]))
    expect(blocks.map((b) => [text(b), b.align])).toEqual([['Overcoming\nnervousness!', 'center'], ['Mirjam Nilsson', 'center']])
  })

  test('a ruled line between table rows keeps cells apart; text far apart on one baseline is two blocks', () => {
    const rule = { x0: 40, x1: 200, y0: 170, y1: 170, width: 0.5, color: 'rgb(0,0,0)' }
    const cells = placedBlocks(page([...row('R1C1', 45, 164, 12), ...row('R2C1', 45, 184, 12)], { shapes: { rules: [rule], fills: [], dots: [] } }))
    expect(cells.map(text)).toEqual(['R1C1', 'R2C1'])
    const footer = placedBlocks(page([...row('Presentation title', 81, 520, 12), ...row('5', 886, 520, 12)]))
    expect(footer.map(text)).toEqual(['Presentation title', '5'])
  })
})
