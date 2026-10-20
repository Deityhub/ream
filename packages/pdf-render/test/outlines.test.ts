import { describe, expect, test } from 'vitest'
import { readTables } from '@ream/pdf-core'
import { CFF_GLYPHS, GLYPHS, glyphOf, glyphsOnly, makeCff, makeTtf, makeType1 } from '../../pdf-core/test/ttf-helper.ts'
import { readCff, readProgram, readTrueType, readType1 } from '../src/outlines/index.ts'

const box = (x0: number, y0: number, x1: number, y1: number) => [['M', x0, y0], ['L', x1, y0], ['L', x1, y1], ['L', x0, y1], ['Z']]

describe('TrueType outlines', () => {
  const font = readTrueType(makeTtf())

  test('a simple glyph is its points; a composite is its parts, moved', () => {
    expect(font.glyph(GLYPHS.A)).toEqual([['M', 50, 0], ['L', 550, 0], ['L', 550, 700], ['L', 50, 700], ['L', 50, 0], ['Z']])
    const aacute = font.glyph(GLYPHS.Aacute)!
    expect(aacute.filter((c) => c[0] === 'M')).toEqual([['M', 50, 0], ['M', 100, 750]])
    expect(font.glyph(GLYPHS.space)).toEqual([])
    expect(font.matrix).toEqual([0.001, 0, 0, 0.001, 0, 0])
    expect(font.advance(GLYPHS.A)).toBe(600)
  })

  test('cmap subtables by platform and encoding, and Unicode lookups', () => {
    expect(font.cmap(3, 1)?.(65)).toBe(GLYPHS.A)
    expect(font.cmap(3, 0)).toBeNull()
    expect(font.byUnicode('Ж')).toBe(GLYPHS.Zhe)
    expect(font.byUnicode('Q')).toBeUndefined()
  })

  test('off-curve points: midpoints between two in a row, and a contour of only control points', () => {
    // a bare program of head, loca and glyf (no cmap, hmtx or hhea), as PDFs often embed them
    const f = readTrueType(glyphsOnly([new Uint8Array(0), glyphOf([[0, 0, true], [100, 0, false], [100, 100, false], [0, 100, true]]), glyphOf([[0, 0, false], [100, 0, false], [100, 100, false], [0, 100, false]])]))
    expect(f.glyph(1)).toEqual([['M', 0, 0], ['Q', 100, 0, 100, 50], ['Q', 100, 100, 0, 100], ['L', 0, 0], ['Z']])
    expect(f.glyph(2)).toEqual([['M', 0, 50], ['Q', 0, 0, 50, 0], ['Q', 100, 0, 100, 50], ['Q', 100, 100, 50, 100], ['Q', 0, 100, 0, 50], ['Z']])
    expect(f.advance(1)).toBeUndefined()
    expect(f.glyph(3)).toBeNull()
  })
})

describe('CFF outlines', () => {
  test('Type 2 charstrings: the advance width is dropped, subroutines are followed, hflex makes two curves', () => {
    const f = readCff(makeCff())
    expect(f.cid).toBe(false)
    expect(f.glyph(CFF_GLYPHS.A)).toEqual(box(50, 0, 550, 700))
    expect(f.glyph(CFF_GLYPHS.O)).toEqual([['M', 0, 0], ['C', 100, 0, 200, 50, 300, 50], ['C', 400, 50, 500, 0, 600, 0], ['Z']])
    expect(f.glyph(CFF_GLYPHS.space)).toEqual([])
  })

  test('glyphs by name, by Unicode, by the standard encoding; endchar with four operands is an accented letter', () => {
    const f = readCff(makeCff())
    expect(f.byName('Aacute')).toBe(CFF_GLYPHS.Aacute)
    expect(f.byUnicode('Á')).toBe(CFF_GLYPHS.Aacute)
    expect(f.builtin?.(65)).toBe(CFF_GLYPHS.A)
    expect(f.glyph(CFF_GLYPHS.Aacute)).toEqual([...box(50, 0, 550, 700), ...box(200, 750, 400, 900)])
  })

  test('CID-keyed: glyphs by CID through the charset, local subroutines from the font dict', () => {
    const f = readCff(makeCff({ cid: true }))
    expect(f.cid).toBe(true)
    expect(f.byCid(101)).toBe(CFF_GLYPHS.A)
    expect(f.byCid(5)).toBeUndefined()
    // the font dict's matrix (here the default) takes glyphs straight to text space
    expect(f.matrix).toEqual([1, 0, 0, 1, 0, 0])
    expect(f.glyph(CFF_GLYPHS.A)?.[1]).toEqual(['L', 0.55, 0])
  })

  test('an OpenType font: the CFF table inside it', () => {
    const p = readProgram({ kind: 'sfnt', bytes: makeTtf({ cff: 'plain' }) })
    expect(p?.glyph(CFF_GLYPHS.A)).toEqual(box(50, 0, 550, 700))
    expect(readTables(makeTtf({ cff: 'plain' })).has('CFF ')).toBe(true)
  })
})

describe('Type 1 outlines', () => {
  const { bytes, length1 } = makeType1()
  const f = readType1(bytes, length1)

  test('eexec and charstring decryption, hsbw, subroutines', () => {
    expect(f.glyph(f.byName('A')!)).toEqual(box(50, 0, 550, 700))
    expect(f.matrix).toEqual([0.001, 0, 0, 0.001, 0, 0])
  })

  test('flex through the standard subroutines: two curves, ending where setcurrentpoint says', () => {
    expect(f.glyph(f.byName('O')!)).toEqual([['M', 0, 0], ['C', 100, 50, 200, 50, 300, 0], ['C', 400, 0, 500, 50, 600, 0], ['Z']])
  })

  test('seac: the accent is moved by adx, less its side bearing, plus the base side bearing', () => {
    expect(f.glyph(f.byName('Aacute')!)).toEqual([...box(50, 0, 550, 700), ...box(200, 750, 400, 900)])
  })

  test('the built-in encoding, and Length1 missing or wrong', () => {
    expect(f.builtin?.(66)).toBe(f.byName('O'))
    const again = readType1(bytes)
    expect(again.glyph(again.byName('A')!)).toEqual(box(50, 0, 550, 700))
    expect(readType1(bytes, 3).byName('A')).toBe(f.byName('A'))
  })
})

describe('hostile font programs', () => {
  test('a subroutine that calls itself, a truncated font and garbage give no glyph, never an exception', () => {
    const cff = makeCff()
    // turn subroutine 0's "return" into a call of itself
    const at = cff.lastIndexOf(11)
    const loop = cff.slice()
    loop.set([139 - 107, 10], at - 1)
    expect(readCff(loop).glyph(CFF_GLYPHS.A)).toBeNull()
    expect(readProgram({ kind: 'cff', bytes: cff.subarray(0, 30) })).toBeNull()
    expect(readProgram({ kind: 'sfnt', bytes: new Uint8Array([0, 1, 0, 0, 0, 9, 1, 2]) })).toBeNull()
    expect(readProgram({ kind: 'type1', bytes: new TextEncoder().encode('%!PS no font here') })).toBeNull()
  })
})
