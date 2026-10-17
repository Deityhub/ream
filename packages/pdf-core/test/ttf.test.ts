import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfFontError, PdfStream, decodeStream, parseTtf, prepareFont, stamp, subsetTtf, embeddedResource, name } from '../src/index.ts'
import { classicPdf } from './helpers.ts'
import { GLYPHS, makeTtf } from './ttf-helper.ts'

const read = (bytes: Uint8Array) => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = new Map<string, Uint8Array>()
  for (let i = 0; i < v.getUint16(4); i++) {
    const at = 12 + i * 16
    tables.set(String.fromCharCode(...bytes.subarray(at, at + 4)), bytes.subarray(v.getUint32(at + 8), v.getUint32(at + 8) + v.getUint32(at + 12)))
  }
  return tables
}
const sum = (b: Uint8Array) => {
  let s = 0
  for (let i = 0; i < b.length; i += 4) s = (s + (((b[i] << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0)) >>> 0
  return s
}

describe('parseTtf', () => {
  test('reads the name, metrics and character map', () => {
    const f = parseTtf(makeTtf())
    expect(f).toMatchObject({ name: 'TestFont', unitsPerEm: 1000, numGlyphs: 6, ascent: 800, descent: -200 })
    expect(f.glyphFor(65)).toBe(GLYPHS.A)
    expect(f.glyphFor(0x416)).toBe(GLYPHS.Zhe)
    expect(f.glyphFor(0xc1)).toBe(GLYPHS.Aacute)
    expect(f.glyphFor(0x20)).toBe(GLYPHS.space)
    expect(f.glyphFor(0x5d0)).toBe(0) // Hebrew: not in this font
    expect(f.advance(GLYPHS.Zhe)).toBe(700)
  })

  test('files it can not use are refused with a message that says why', () => {
    expect(() => parseTtf(Uint8Array.from([...'wOFF'].map((c) => c.charCodeAt(0)).concat(new Array(20).fill(0))))).toThrow('web font')
    expect(() => parseTtf(new TextEncoder().encode('this is not a font at all'))).toThrow("isn't a TrueType or OpenType font")
    expect(() => parseTtf(makeTtf({ fsType: 2 }))).toThrow('does not allow it to be embedded')
    expect(() => parseTtf(makeTtf({ fsType: 8 }))).not.toThrow() // editable embedding is fine
  })
})

describe('subsetTtf', () => {
  test('keeps the glyphs asked for and the parts of composites, empties the rest, and is a valid file', () => {
    const font = parseTtf(makeTtf())
    const out = subsetTtf(font, [GLYPHS.Aacute])
    const t = read(out)
    expect([...t.keys()].sort()).toEqual(['glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp'])
    expect(sum(out)).toBe(0xb1b0afba) // the whole file adds up the way TrueType says it should
    const loca = new DataView(t.get('loca')!.buffer, t.get('loca')!.byteOffset)
    const len = (g: number) => loca.getUint32((g + 1) * 4) - loca.getUint32(g * 4)
    expect(len(GLYPHS.Aacute)).toBeGreaterThan(0)
    expect(len(GLYPHS.A)).toBeGreaterThan(0) // used by the composite
    expect(len(GLYPHS.accent)).toBeGreaterThan(0)
    expect(len(GLYPHS.Zhe)).toBe(0)
    expect(out.length).toBeLessThan(makeTtf().length)
  })
})

describe('prepareFont', () => {
  test('encodes text as glyph numbers and measures it with the font’s own widths', async () => {
    const f = await prepareFont(makeTtf(), 'AЖ A')
    expect(f.encode('AЖ')).toBe('<00020003>')
    expect(f.width('AЖ A', 10)).toBeCloseTo((600 + 700 + 250 + 600) / 100, 5)
    expect(f.capHeight(10)).toBeCloseTo(5.6, 5)
  })

  test('a letter the font does not have is named', async () => {
    await expect(prepareFont(makeTtf(), 'AЖש')).rejects.toThrow('no glyph for "ש"')
    await expect(prepareFont(makeTtf(), 'Hi')).rejects.toBeInstanceOf(PdfFontError)
  })

  test('written into a stamped PDF: a Type0 font with its widths and a map back to the text', async () => {
    const font = await prepareFont(makeTtf(), 'AЖ')
    const bytes = stamp(await PdfDocument.load(classicPdf(['x'])), () => ({ content: `BT /${embeddedResource('F')} 20 Tf 50 50 Td ${font.encode('AЖ')} Tj ET`, embedded: { F: font } }))
    const doc = await PdfDocument.load(bytes)
    const res = doc.resolve(doc.pages()[0].dict.get('Resources')) as Map<string, unknown>
    const fonts = doc.resolve(res.get('Font') as never) as Map<string, unknown>
    const f = doc.resolve(fonts.get('ReamEmbF') as never) as Map<string, unknown>
    expect(f.get('Subtype')).toEqual(name('Type0'))
    expect(f.get('Encoding')).toEqual(name('Identity-H'))
    const cid = doc.resolve((f.get('DescendantFonts') as unknown[])[0] as never) as Map<string, unknown>
    expect(cid.get('Subtype')).toEqual(name('CIDFontType2'))
    expect(cid.get('W')).toEqual([2, [600], 3, [700]])
    const desc = doc.resolve(cid.get('FontDescriptor') as never) as Map<string, unknown>
    const file = doc.resolve(desc.get('FontFile2') as never) as PdfStream
    const program = await decodeStream(file)
    expect(program.length).toBe(file.dict.get('Length1'))
    expect(sum(program)).toBe(0xb1b0afba)
    const map = new TextDecoder().decode(await decodeStream(doc.resolve(f.get('ToUnicode') as never) as PdfStream))
    expect(map).toContain('<0003> <0416>')
    expect(map).toContain('<0002> <0041>')
  })

  test('one font on every page is stored once', async () => {
    const font = await prepareFont(makeTtf(), 'A')
    const bytes = stamp(await PdfDocument.load(classicPdf(['1', '2', '3'])), () => ({ content: `BT /${embeddedResource('F')} 9 Tf ${font.encode('A')} Tj ET`, embedded: { F: font } }))
    const doc = await PdfDocument.load(bytes)
    const programs = [...doc.objects.values()].filter((o) => o instanceof PdfStream && o.dict.has('Length1'))
    expect(programs).toHaveLength(1)
  })
})

test('OpenType fonts with PostScript (CFF) outlines are embedded whole as OpenType; CID-keyed ones are refused', async () => {
  const font = parseTtf(makeTtf({ cff: 'plain' }))
  expect(font.cff).toBe(true)
  expect(font.glyphFor(65)).toBe(GLYPHS.A)
  const p = await prepareFont(font, 'AA')
  const objs = new Map<number, unknown>()
  let n = 0
  const ref = p.write({ reserve: () => ({ num: ++n, gen: 0 }) as never, set: (r: { num: number }, o: unknown) => void objs.set(r.num, o) } as never)
  const all = [...objs.values()]
  const dicts = all.map((o) => (o instanceof Map ? o : (o as { dict?: Map<string, unknown> }).dict)).filter(Boolean) as Map<string, { value?: string }>[]
  const cid = dicts.find((d) => d.get('Subtype')?.value === 'CIDFontType0')
  expect(cid).toBeDefined()
  expect(cid!.has('CIDToGIDMap')).toBe(false)
  expect(dicts.some((d) => d.has('FontFile3'))).toBe(true)
  expect(dicts.some((d) => d.get('Subtype')?.value === 'OpenType')).toBe(true)
  expect(p.encode('A')).toBe(`<000${GLYPHS.A}>`)
  expect(ref).toBeDefined()
  expect(() => parseTtf(makeTtf({ cff: 'cid' }))).toThrow(/character collection/)
})
