import { describe, expect, test } from 'vitest'
import { analyzePage, removeOutside, type Box } from '../src/index.ts'
import { latin1 } from '../../pdf-core/src/bytes.ts'
import { onePage, stream } from './helpers.ts'

const WIDTHS = `/FirstChar 32 /LastChar 126 /Widths [${Array(95).fill(500).join(' ')}]`
const FONT = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ${WIDTHS} >>` // every glyph half an em wide
const BARE_FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' // no widths: the renderer would have to guess
const IMAGE = stream('/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', 'A')
const page = (content: string, extra: { resources?: string; objects?: Record<number, string> } = {}) => onePage({ content, box: '[0 0 200 200]', ...extra })
const bboxes = async (content: string, extra = {}) => (await analyzePage(await page(content, extra), 0)).ops.filter((o) => o.bbox).map((o) => [o.op, o.bbox as Box] as const)
const text = (b: Uint8Array) => latin1(b)

describe('where things are painted', () => {
  test('paths, with the matrix applied and strokes widened', async () => {
    const found = await bboxes('0 0 50 50 re f q 2 0 0 2 100 100 cm 0 0 10 10 re f Q 10 190 m 60 190 l S')
    expect(found[0]).toEqual(['f', [0, 0, 50, 50]])
    expect(found[1]).toEqual(['f', [100, 100, 120, 120]])
    expect(found[2][0]).toBe('S')
    const [x1, y1, x2, y2] = found[2][1]
    expect(x1).toBeLessThan(10)
    expect(x2).toBeGreaterThan(60)
    expect(y1).toBeLessThan(190)
    expect(y2).toBeGreaterThan(190)
  })
  test('a picture is its unit square under the matrix, without being decoded', async () => {
    const found = await bboxes('q 30 0 0 20 5 5 cm /Im Do Q', { resources: '/XObject << /Im 10 0 R >>', objects: { 10: IMAGE } })
    expect(found).toEqual([['Do', [5, 5, 35, 25]]])
  })
  test('text covers where its glyphs go', async () => {
    const [[op, b]] = await bboxes('BT /F1 10 Tf 20 30 Td (Hi) Tj ET', { resources: '/Font << /F1 10 0 R >>', objects: { 10: FONT } })
    expect(op).toBe('Tj')
    expect(b[0]).toBeLessThanOrEqual(20)
    expect(b[2]).toBeGreaterThanOrEqual(30)
    expect(b[1]).toBeLessThan(30)
    expect(b[3]).toBeGreaterThan(30)
  })
  test('a form is one unit covering everything it draws', async () => {
    const form = stream('/Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources << >>', '10 10 5 5 re f 150 150 5 5 re f')
    const found = await bboxes('/Fm Do', { resources: '/XObject << /Fm 10 0 R >>', objects: { 10: form } })
    expect(found).toEqual([['Do', [10, 10, 155, 155]]])
  })
})

describe('removing what is outside', () => {
  const resources = '/XObject << /ImIn 10 0 R /ImOut 10 0 R >> /Font << /F1 11 0 R >>'
  const objects = { 10: IMAGE, 11: FONT }
  const content = [
    '1 0 0 rg 10 10 30 30 re f',
    '0 0 1 rg 150 150 40 40 re f',
    'q 30 0 0 30 12 60 cm /ImIn Do Q',
    'q 30 0 0 30 150 20 cm /ImOut Do Q',
    'BT /F1 12 Tf 15 100 Td (inside text) Tj ET',
    'BT /F1 12 Tf 150 100 Td (outside text) Tj ET',
  ].join('\n')
  const keep: Box = [0, 0, 100, 120]

  test('only what lies fully outside goes; the clip of a removed path stays', async () => {
    const doc = await page(content, { resources, objects })
    const r = await removeOutside(doc, 0, keep)
    const out = text(r.content)
    expect(out).toContain('10 10 30 30 re f')
    expect(out).toContain('150 150 40 40 re n')
    expect(out).not.toContain('150 150 40 40 re f')
    expect(out).toContain('/ImIn Do')
    expect(out).not.toContain('/ImOut Do')
    expect(out).toContain('(inside text) Tj')
    expect(out).not.toContain('outside text')
    expect(r.removed).toBe(3)
    expect(r.used?.names.XObject).toEqual(new Set(['ImIn']))
    expect(r.used?.names.Font).toEqual(new Set(['F1']))
  })

  test('text after a removed string does not move', async () => {
    // the first string is outside; a number then moves the position back inside, and the second string is shown there
    const c = 'BT /F1 10 Tf 150 100 Td (AB) Tj [11000] TJ (CD) Tj ET'
    const before = await page(c, { resources: '/Font << /F1 10 0 R >>', objects: { 10: FONT } })
    const r = await removeOutside(before, 0, [0, 0, 100, 200])
    expect(text(r.content)).not.toContain('(AB)')
    const where = async (content: string) => (await bboxes(content, { resources: '/Font << /F1 10 0 R >>', objects: { 10: FONT } })).find(([op]) => op === 'Tj')![1]
    const kept = (await bboxes(c, { resources: '/Font << /F1 10 0 R >>', objects: { 10: FONT } })).filter(([op]) => op === 'Tj')
    expect((await where(text(r.content)))[0]).toBeCloseTo(kept[1][1][0], 6) // CD is exactly where it was
  })

  test('when widths are unknown, a string is removed only if nothing depends on its length', async () => {
    const res = { resources: '/Font << /F1 10 0 R >>', objects: { 10: BARE_FONT } }
    const alone = await removeOutside(await page('BT /F1 10 Tf 150 100 Td (gone) Tj 0 -12 Td (stays) Tj ET', res), 0, [0, 0, 100, 200])
    expect(text(alone.content)).not.toContain('(gone)')
    const followed = await removeOutside(await page('BT /F1 10 Tf 150 100 Td (kept) Tj (next) Tj ET', res), 0, [0, 0, 100, 200])
    expect(text(followed.content)).toContain('(kept)')
  })

  test('quote operators keep their line movement', async () => {
    const res = { resources: '/Font << /F1 10 0 R >>', objects: { 10: FONT } }
    const r = await removeOutside(await page("BT /F1 10 Tf 12 TL 150 150 Td (gone) ' 0 -30 Td (x) Tj ET", res), 0, [0, 0, 100, 100])
    expect(text(r.content)).toContain('T*')
    expect(text(r.content)).not.toContain('(gone)')
  })

  test('what might be visible is kept: shadings, invisible text, a form that straddles the edge', async () => {
    const shading = '<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 200 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >>'
    const straddle = stream('/Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources << >>', '10 10 5 5 re f 150 150 5 5 re f')
    const outsideForm = stream('/Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources << >>', '150 150 5 5 re f')
    const doc = await page('/Sh sh /Straddle Do /Away Do BT /F1 10 Tf 3 Tr 150 150 Td (hidden) Tj ET', {
      resources: '/Shading << /Sh 10 0 R >> /XObject << /Straddle 11 0 R /Away 12 0 R >> /Font << /F1 13 0 R >>',
      objects: { 10: shading, 11: straddle, 12: outsideForm, 13: FONT },
    })
    const out = text((await removeOutside(doc, 0, [0, 0, 100, 100])).content)
    expect(out).toContain('/Sh sh')
    expect(out).toContain('/Straddle Do')
    expect(out).not.toContain('/Away Do')
    expect(out).toContain('(hidden) Tj')
  })

  test('an inline picture outside is cut', async () => {
    const r = await removeOutside(await page('q 20 0 0 20 150 150 cm BI /W 2 /H 2 /CS /G /BPC 8 ID ABCD EI Q 10 10 5 5 re f'), 0, [0, 0, 100, 100])
    expect(text(r.content)).not.toContain('BI')
    expect(text(r.content)).toContain('10 10 5 5 re f')
  })

  test('a form without resources of its own means all resources are kept', async () => {
    const bare = stream('/Type /XObject /Subtype /Form /BBox [0 0 200 200]', '10 10 5 5 re f')
    const r = await removeOutside(await page('/Fm Do', { resources: '/XObject << /Fm 10 0 R >>', objects: { 10: bare } }), 0, [0, 0, 100, 100])
    expect(r.used).toBeNull()
  })

  test('nothing outside means nothing changes', async () => {
    const c = '10 10 5 5 re f\nBT /F1 10 Tf 20 20 Td (hi) Tj ET'
    const r = await removeOutside(await page(c, { resources: '/Font << /F1 10 0 R >>', objects: { 10: FONT } }), 0, [0, 0, 200, 200])
    expect(text(r.content)).toBe(c + '\n')
    expect(r.removed).toBe(0)
  })
})
