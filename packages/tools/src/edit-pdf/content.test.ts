import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { PdfDocument } from '@ream/pdf-core'
import { pageChars, pageContentShares } from '@ream/pdf-render'
import { nodeFonts } from '../fonts/node.ts'
import { fakePlatform } from '../../../pdf-render/test/helpers.ts'
import { contentEdits, lineItem, lookalikeOf, missingLetters, usesOwn } from './content.ts'
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

  test('a line only picked, not changed, changes nothing', async () => {
    const { lines } = await pageContentShares(await PdfDocument.load(bytes), 0)
    await expect(save([lineItem('a', 0, lines[0])])).rejects.toThrow(/Change something first/)
  })
})
