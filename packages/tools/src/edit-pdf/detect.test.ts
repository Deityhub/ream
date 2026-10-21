import { describe, expect, test } from 'vitest'
import { detectFields, type PageLayout } from './detect.ts'
import { suggestedFields } from './fields.ts'

/** letters 6 points wide at 10 points, on a baseline */
const word = (text: string, x: number, base: number) => [...text].map((t, i) => ({ text: t, x0: x + i * 6, x1: x + i * 6 + 6, y0: base - 8, y1: base + 2, size: 10 }))
const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x0, y0, x1, y1: y0 }, { x0, y0: y1, x1, y1 }, { x0, y0, x1: x0, y1 }, { x0: x1, y0, x1, y1 },
]
const page = (chars: PageLayout['chars'], rules: PageLayout['rules'] = []): PageLayout => ({ width: 600, height: 800, chars, rules })
const pts = (b: { x: number; y: number; w: number; h: number }) => [b.x * 600, b.y * 800, b.w * 600, b.h * 800].map(Math.round)

describe('edit-pdf: finding form fields', () => {
  test('underscores and dotted lines are fields, named by the words before them', () => {
    const found = detectFields(page([...word('Full name:', 50, 100), ...word('__________', 120, 100), ...word('City', 50, 130), ...word('........', 80, 130)]))
    expect(found.map((f) => [f.type, f.label])).toEqual([['text', 'Full name'], ['text', 'City']])
    expect(pts(found[0].box)[0]).toBe(120)
    expect(pts(found[0].box)[2]).toBe(60)
  })

  test('a line to write on, an empty box and a square to tick, named by their labels', () => {
    const found = detectFields(page(
      [...word('Email', 50, 200), ...word('Address', 50, 240), ...word('I agree', 70, 330)],
      [{ x0: 90, y0: 202, x1: 300, y1: 202 }, ...rect(50, 250, 300, 280), ...rect(50, 320, 60, 330)],
    ))
    expect(found.map((f) => [f.type, f.label])).toEqual([['text', 'Email'], ['text', 'Address'], ['checkbox', 'I agree']])
    expect(pts(found[0].box)).toEqual([90, 184, 210, 18])
  })

  test('not over text already written, table rows, boxes with text in them, or fields already there', () => {
    const found = detectFields(page(
      [...word('Written on', 100, 200), ...word('Cell', 60, 270)],
      [{ x0: 90, y0: 202, x1: 300, y1: 202 }, ...rect(50, 250, 300, 280), { x0: 50, y0: 400, x1: 300, y1: 400 }, { x0: 50, y0: 380, x1: 50, y1: 420 }],
    ))
    expect(found).toEqual([])
    const line = page(word('Email', 50, 200), [{ x0: 90, y0: 202, x1: 300, y1: 202 }])
    expect(detectFields(line, [{ x: 90 / 600, y: 184 / 800, w: 210 / 600, h: 18 / 800 }])).toEqual([])
  })

  test('suggestions become fields with names of their own', () => {
    let n = 0
    const found = detectFields(page([...word('Name', 50, 100), ...word('______', 90, 100), ...word('Name', 50, 130), ...word('______', 90, 130)]))
    expect(suggestedFields(found, 0, [], () => `s${n++}`).map((f) => f.name)).toEqual(['Name', 'Name 2'])
    const signed = detectFields(page([...word('Signature', 50, 100), ...word('______', 110, 100), ...word('Date of birth', 50, 130), ...word('______', 140, 130)]))
    expect(suggestedFields(signed, 0, [], () => `s${n++}`).map((f) => f.type)).toEqual(['signature', 'date'])
  })
})
