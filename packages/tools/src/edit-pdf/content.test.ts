import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { PdfDocument } from '@ream/pdf-core'
import { pageChars, pageContentShares } from '@ream/pdf-render'
import { nodeFonts } from '../fonts/node.ts'
import { fakePlatform } from '../../../pdf-render/test/helpers.ts'
import { contentEdits, lineItem, liveChars, lookalikeOf, missingLetters, usesOwn } from './content.ts'
import { pickText } from './geometry.ts'
import { run } from './run.ts'
import { defaultOptions, type Item } from './items.ts'

// printed by Chromium: its fonts are embedded subsets, with only the letters the page uses
const bytes = new Uint8Array(readFileSync(new URL('../../../pdf-core/test/fixtures/chromium.pdf', import.meta.url)))
const save = async (items: Item[]) => {
  const [out] = await run([{ name: 'c.pdf', type: 'application/pdf', bytes }], { ...defaultOptions, items }, { progress: () => {} }, nodeFonts, fakePlatform().platform)
  return PdfDocument.load(out.bytes)
}
const textOf = async (doc: PdfDocument) => (await pageChars(doc, 0)).chars.map((c) => c.text).join('')

describe('edit-pdf: the page\'s own content', () => {
  test('a stand-in font by the name of the PDF\'s, else by its kind', () => {
    expect(lookalikeOf('Helvetica', 'sans')).toBe('Arial')
    expect(lookalikeOf('Times', 'serif')).toBe('Times New Roman')
    expect(lookalikeOf('Calibri', 'sans')).toBe('Calibri')
    expect(lookalikeOf('', 'mono')).toBe('Courier New')
    expect(lookalikeOf('Georgia', 'serif')).toBe('Cambria')
  })

  test('a fix in the line\'s own font; a letter its subset lacks moves the line to a stand-in; an erased line is gone', async () => {
    const { lines } = await pageContentShares(await PdfDocument.load(bytes), 0)
    const title = { ...lineItem('a', 0, lines[0]), text: 'Chromium page 2' }
    const body = { ...lineItem('b', 0, lines[1]), text: 'Zebra' }
    expect(usesOwn(title)).toBe(true)
    expect(missingLetters(body)).toEqual(['Z', 'b'])
    // a thin box through the middle of the fourth line: a box that touches the lines above and below would take them too
    const b = lines[3].box
    const erase: Item = { id: 'e', page: 0, kind: 'erase', box: { x: b.x, y: b.y + b.h * 0.45, w: b.w, h: b.h * 0.1 } }
    const { edits, draw } = contentEdits([title, body, erase], [{ width: 596, height: 843 }])
    expect(edits.get(0)!.lines!.map((l) => [l.id, l.own])).toEqual([[0, true], [1, false]])
    // drawn in its own family: a font added for it, else the look-alike the font book picks (Tinos for Times)
    expect(draw.map((d) => (d.kind === 'text' ? [d.text, d.font] : null))).toEqual([['Zebra', 'Times']])

    const out = await save([title, body, erase])
    const all = await textOf(out)
    expect(all).toContain('Chromium page 2')
    expect(all).toContain('Zebra')
    expect(all).not.toContain('Chromium page 1')
    // the stand-in line is drawn over the page, so the page's own lines are the title and the four not erased
    const after = (await pageContentShares(out, 0)).lines.map((l) => l.text)
    expect(after.sort()).toEqual(['Chromium page 2', ...[2, 4, 5, 6].map((k) => lines[k].text)].sort())
  })

  test('a picture moved keeps its place in the file; one replaced goes, with the new one drawn in its box', () => {
    const base = { page: 0, kind: 'picture' as const, from: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, preview: '' }
    const moved: Item = { ...base, id: 'm', source: 0, box: { x: 0.5, y: 0.1, w: 0.4, h: 0.2 } }
    const swapped: Item = { ...base, id: 's', source: 1, box: base.from, replace: { data: new Uint8Array([1]), type: 'image/png' } }
    const still: Item = { ...base, id: 'u', source: 2, box: base.from }
    const { edits, draw } = contentEdits([moved, swapped, still], [{ width: 100, height: 200 }])
    const round = (b: Record<string, number> | null) => b && Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v)]))
    expect(edits.get(0)!.pictures!.map((p) => ({ id: p.id, box: round(p.box) }))).toEqual([{ id: 0, box: { x0: 50, y0: 20, x1: 90, y1: 60 } }, { id: 1, box: null }])
    expect(draw).toMatchObject([{ kind: 'image', box: base.from }])
  })

  test('marking text picks the page as it is now: a moved line is found where it was put, and no longer where it was', () => {
    const size = { width: 100, height: 100 }
    // two lines of three letters (10 pt a letter): "ABC" at the top left and "XYZ" below it
    const at = (text: string, x: number, y: number) => [...text].map((t, i) => ({ text: t, x0: x + (i * 10) / 100, x1: x + ((i + 1) * 10) / 100, y0: y, y1: y + 0.1 }))
    const chars = [...at('ABC', 0.1, 0.1), ...at('XYZ', 0.1, 0.4)]
    const line = (id: string, text: string, x: number, y: number) => lineItem(id, 0, { id: 0, text, box: { x, y, w: 0.3, h: 0.125 }, baseline: 0.1, size: 10, colour: [0, 0, 0], face: 'Helvetica', kind: 'sans', bold: false, italic: false, letters: text })
    const abc = { ...line('a', 'ABC', 0.1, 0.1), box: { x: 0.5, y: 0.7, w: 0.3, h: 0.125 } } // moved to the lower right
    const measure = () => (t: string) => t.length * 10 // every letter 10 pt wide
    const now = liveChars(chars, [abc], 0, size, measure)
    const text = (box: { x: number; y: number; w: number; h: number }) => pickText(now, box).text
    expect(text({ x: 0, y: 0.05, w: 0.6, h: 0.2 })).toBe('') // where ABC was: nothing now
    expect(text({ x: 0.45, y: 0.65, w: 0.5, h: 0.25 })).toBe('ABC') // where it is now
    expect(text({ x: 0.45, y: 0.65, w: 0.23, h: 0.25 })).toBe('AB') // part of it, by its letters' places
    // a moved line brings the file's own letters, not a measure: with a measure that is wrong, the places are still the file's
    const wrong = liveChars(chars, [abc], 0, size, () => (t: string) => t.length * 99)
    expect(wrong.filter((c) => 'ABC'.includes(c.text)).map((c) => +c.x0.toFixed(2))).toEqual([0.5, 0.6, 0.7])
    // a retyped line is laid out by the measure
    const typed = liveChars(chars, [{ ...abc, text: 'ABCD' }], 0, size, measure)
    expect(typed.filter((c) => 'ABCD'.includes(c.text)).map((c) => +c.x0.toFixed(2))).toEqual([0.5, 0.6, 0.7, 0.8])
    expect(text({ x: 0, y: 0.35, w: 0.6, h: 0.2 })).toBe('XYZ') // the other line is as it was
    // a line taken out has no letters; an unchanged page is the file's own
    expect(liveChars(chars, [{ ...abc, deleted: true }], 0, size, measure).map((c) => c.text).join('')).toBe('XYZ')
    expect(liveChars(chars, [lineItem('u', 0, { id: 0, text: 'ABC', box: { x: 0.1, y: 0.1, w: 0.3, h: 0.125 }, baseline: 0.1, size: 10, colour: [0, 0, 0], face: '', kind: 'sans', bold: false, italic: false, letters: 'ABC' })], 0, size, measure)).toBe(chars)
  })

  test('text added with the Text tool can be marked: its letters are laid out as the editor draws them', () => {
    const size = { width: 100, height: 100 }
    const measure = () => (t: string) => t.length * 10 // every letter 10 pt wide
    const text = (over: Record<string, unknown> = {}): Item => ({ id: 't', page: 0, kind: 'text', box: { x: 0.1, y: 0.2, w: 0.25, h: 0.1 }, text: 'AB CD', font: 'Arial', size: 10, colour: '#000000', bold: false, italic: false, align: 'left', spacing: 1.2, opacity: 1, ...over }) as Item
    // 25 pt wide: "AB CD" breaks after "AB", so two lines of 12 pt, the first baseline about 9.5 pt down
    const chars = liveChars([], [text()], 0, size, measure)
    expect(chars.map((c) => c.text).join('')).toBe('ABCD')
    expect(chars.map((c) => +c.x0.toFixed(2))).toEqual([0.1, 0.2, 0.1, 0.2])
    const first = chars[0]
    expect(first.y0).toBeCloseTo(0.2 + 0.0947 - 0.08, 3)
    expect(first.y1 - first.y0).toBeCloseTo(0.1, 5)
    // dragged over, whole and in part
    expect(pickText(chars, { x: 0.08, y: 0.2, w: 0.3, h: 0.25 }).text).toBe('AB CD')
    expect(pickText(chars, { x: 0.08, y: 0.2, w: 0.3, h: 0.12 }).text).toBe('AB')
    // right aligned, the lines end at the box's right edge
    const right = liveChars([], [text({ align: 'right' })], 0, size, measure)
    expect(right.map((c) => +c.x1.toFixed(2))).toEqual([0.35, 0.35, 0.35, 0.35].map((v, i) => (i % 2 ? v : +(v - 0.1).toFixed(2))))
    // on every page, and empty text, count as they do when it is saved
    expect(liveChars([], [text({ page: 3, everyPage: true })], 0, size, measure)).toHaveLength(4)
    expect(liveChars([], [text({ text: '  ' })], 0, size, measure)).toHaveLength(0)
  })

  test('a line only picked, not changed, changes nothing', async () => {
    const { lines } = await pageContentShares(await PdfDocument.load(bytes), 0)
    await expect(save([lineItem('a', 0, lines[0])])).rejects.toThrow(/Change something first/)
  })
})
