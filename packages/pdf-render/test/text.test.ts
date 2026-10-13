import { describe, expect, test } from 'vitest'
import { renderPage } from '../src/index.ts'
import { baseEncodings, glyphToUnicode, macRoman, standard, winAnsi } from '../src/encodings.ts'
import { parseToUnicode } from '../src/cmap.ts'
import { classify, loadFont, nameCandidates } from '../src/font.ts'
import { fakeCtx, hex, onePage, stream } from './helpers.ts'

describe('encodings', () => {
  test('every table has 256 entries', () => {
    for (const t of [winAnsi, macRoman, standard]) expect(t).toHaveLength(256)
  })

  test('WinAnsi: ASCII, Windows-1252 extras, Latin-1 and the undefined slots', () => {
    expect(winAnsi[65]).toBe('A')
    expect(winAnsi[0x80]).toBe('€')
    expect(winAnsi[0x93]).toBe('“')
    expect(winAnsi[0xe9]).toBe('é')
    expect(winAnsi[0xff]).toBe('ÿ')
    expect(winAnsi[0xa0]).toBe(' ')
    expect(winAnsi[0x81]).toBe('•') // undefined in Windows-1252: a bullet in PDF
  })

  test('MacRoman', () => {
    expect(macRoman[0x8e]).toBe('é')
    expect(macRoman[0xa5]).toBe('•')
    expect(macRoman[0xd2]).toBe('“')
    expect(macRoman[0xdb]).toBe('¤')
    expect(macRoman[0xca]).toBe(' ')
  })

  test('Standard: curly quotes at 0x27 and 0x60, extras above 0xA0, holes stay empty', () => {
    expect(standard[0x27]).toBe('’')
    expect(standard[0x60]).toBe('‘')
    expect(standard[0xae]).toBe('ﬁ')
    expect(standard[0xe1]).toBe('Æ')
    expect(standard[0xb0]).toBe('')
    expect(baseEncodings.WinAnsiEncoding).toBe(winAnsi)
  })

  test('glyph names: letters, digits, punctuation, accents, unicode forms and variants', () => {
    expect(glyphToUnicode('A')).toBe('A')
    expect(glyphToUnicode('space')).toBe(' ')
    expect(glyphToUnicode('seven')).toBe('7')
    expect(glyphToUnicode('eacute')).toBe('é')
    expect(glyphToUnicode('Ntilde')).toBe('Ñ')
    expect(glyphToUnicode('ccedilla')).toBe('ç')
    expect(glyphToUnicode('Euro')).toBe('€')
    expect(glyphToUnicode('fi')).toBe('ﬁ')
    expect(glyphToUnicode('uni20AC')).toBe('€')
    expect(glyphToUnicode('uni00410042')).toBe('AB')
    expect(glyphToUnicode('u1F600')).toBe('😀')
    expect(glyphToUnicode('a.sc')).toBe('a')
    expect(glyphToUnicode('f_i')).toBe('fi')
    expect(glyphToUnicode('g123')).toBeUndefined()
    expect(glyphToUnicode('nonsense')).toBeUndefined()
  })
})

describe('ToUnicode CMaps', () => {
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0003> <0020> <0004> <00660066> endbfchar
2 beginbfrange <0010> <0012> <0041> <0020> <0022> [<0061> <0062> <0063>] endbfrange
endcmap`

  test('bfchar, bfrange with an incrementing destination, and a range given as a list', () => {
    const m = parseToUnicode(cmap)
    expect(m.get(3)).toBe(' ')
    expect(m.get(4)).toBe('ff') // one code, several characters
    expect(m.get(0x10)).toBe('A')
    expect(m.get(0x12)).toBe('C')
    expect(m.get(0x20)).toBe('a')
    expect(m.get(0x22)).toBe('c')
    expect(m.get(0x99)).toBeUndefined()
  })

  test('code lengths come from the codespace ranges', () => {
    expect(parseToUnicode(cmap).codeLengths).toEqual([2])
    expect(parseToUnicode('1 begincodespacerange <00> <FF> endcodespacerange').codeLengths).toEqual([1])
    expect(parseToUnicode('nothing here').codeLengths).toEqual([])
  })

  test('a surrogate pair destination survives', () => {
    expect(parseToUnicode('1 beginbfchar <0001> <D83DDE00> endbfchar').get(1)).toBe('😀')
  })
})

describe('font classification', () => {
  test.each([
    ['Helvetica-Bold', 0, false, true, 'Helvetica'],
    ['ABCDEF+TimesNewRomanPS-ItalicMT', 0, true, false, 'Times'],
    ['CourierNewPSMT', 0, false, false, 'Courier'],
    ['AAAAAB+Monaco', 0, false, false, 'monospace'],
    ['Consolas-Bold', 0, false, true, 'monospace'],
    ['ArialMT', 0, false, false, 'Arial'],
    ['SomethingUnknown', 2, false, false, 'Times'], // serif flag
    ['SomethingUnknown', 1, false, false, 'Courier'], // fixed pitch flag
    ['SomethingUnknown', 0x40000, false, true, 'Helvetica'], // force bold
    ['Foo-Oblique', 0, true, false, 'Helvetica'],
  ])('%s flags %i', (name, flags, italic, bold, family) => {
    const c = classify(name, flags)
    expect(c.italic).toBe(italic)
    expect(c.bold).toBe(bold)
    expect(c.family).toContain(family)
  })

  test('the font\'s own name goes first so an installed copy is used, then the generic stack', () => {
    expect(nameCandidates('ABCDEF+TimesNewRomanPS-BoldMT')).toEqual(['TimesNewRoman', 'Times New Roman'])
    expect(nameCandidates('ArialMT')).toEqual(['Arial'])
    expect(nameCandidates('Menlo-Regular')).toEqual(['Menlo'])
    expect(nameCandidates('Calibri-Bold')).toEqual(['Calibri'])
    expect(nameCandidates('Foo,Bold')).toEqual(['Foo'])
    expect(nameCandidates('')).toEqual([])
    expect(nameCandidates('Weird<>Name')).toEqual([])
    const f = classify('Menlo-Regular', 0).family
    expect(f.startsWith('"Menlo", ')).toBe(true)
    expect(f).toContain('monospace')
  })

  test('descriptor weight and italic angle also count', () => {
    expect(classify('Foo', 0, 700).bold).toBe(true)
    expect(classify('Foo', 0, 400, -12).italic).toBe(true)
  })
})

/** a page with one font at object 10 (plus anything else needed) */
const withFont = (font: string, content: string, objects: Record<number, string> = {}) =>
  onePage({ content, resources: '/Font << /F1 10 0 R >>', objects: { 10: font, ...objects } })

// Every glyph 500 units wide, which is exactly what the fake canvas measures (half an em), so no squeeze-to-fit.
// 10 pt text is drawn on the canvas at 16 px and scaled back, so each glyph matrix carries K = 10/16.
const K = 10 / 16
const SIMPLE = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 126 /Widths [' + Array(95).fill(500).join(' ') + '] >>'

async function shown(font: string, content: string, objects?: Record<number, string>) {
  const doc = await withFont(font, content, objects)
  const f = fakeCtx()
  const result = await renderPage(doc, 0, f.ctx, 100)
  const drawn: { text: string; matrix: number[] }[] = []
  f.calls.forEach((c, i) => {
    if (c[0] !== 'fillText' && c[0] !== 'strokeText') return
    const tf = f.calls.slice(0, i).reverse().find((x) => x[0] === 'setTransform')!
    drawn.push({ text: `${c[0] === 'strokeText' ? 'stroke:' : ''}${c[1]}`, matrix: tf.slice(1) as number[] })
  })
  return { ...f, result, drawn }
}
const at = (g: { matrix: number[] }) => [g.matrix[4], g.matrix[5]]

describe('showing text', () => {
  test('each glyph is placed by the text matrix and advances by its PDF width', async () => {
    const { drawn } = await shown(SIMPLE, 'BT /F1 10 Tf 10 20 Td (AB) Tj ET')
    expect(drawn.map((d) => d.text)).toEqual(['A', 'B'])
    expect(drawn[0].matrix).toEqual([K, 0, 0, K, 10, 80]) // upright on the device: glyph flip x page flip; page is 100 high
    expect(at(drawn[1])).toEqual([15, 80]) // 500/1000 * 10 = 5 further along
  })

  test('the font string carries size, weight and slant', async () => {
    const font = '<< /Type /Font /Subtype /TrueType /BaseFont /Arial-BoldItalicMT /FirstChar 65 /LastChar 65 /Widths [500] >>'
    const { prop, calls } = await shown(font, 'BT /F1 10 Tf (A) Tj ET')
    expect(prop('font', calls.length)).toMatch(/^italic bold 16px /) // drawn at a comfortable size, scaled by the matrix
  })

  test('Tc, Tw and Tz change the advance; Tw only on the space', async () => {
    const { drawn } = await shown(SIMPLE, 'BT /F1 10 Tf 2 Tc 3 Tw (A B) Tj ET')
    // A at 0; advance 5 + 2 = 7; space at 7; advance 5 + 2 + 3 = 10; B at 17
    expect(drawn.map((d) => d.matrix[4])).toEqual([0, 17])
    const z = await shown(SIMPLE, 'BT /F1 10 Tf 50 Tz (AB) Tj ET')
    expect(z.drawn[1].matrix[4]).toBe(2.5) // half the advance
    expect(z.drawn[0].matrix[0]).toBe(0.5 * K) // and glyphs squeezed to half width
  })

  test('Ts raises the baseline in user units', async () => {
    const { drawn } = await shown(SIMPLE, 'BT /F1 10 Tf 4 Ts (A) Tj ET')
    expect(at(drawn[0])).toEqual([0, 100 - 4])
  })

  test('TJ numbers move the next glyph back or forward in thousandths of the font size', async () => {
    const { drawn } = await shown(SIMPLE, 'BT /F1 10 Tf [(A) -1000 (B) 500 (C)] TJ ET')
    // A 0 | +5 advance, +10 kern -> B at 15 | +5, -5 kern -> C at 15
    expect(drawn.map((d) => d.matrix[4])).toEqual([0, 15, 15])
  })

  test('TL, T*, TD, quote and double quote start new lines', async () => {
    const lines = await shown(SIMPLE, 'BT /F1 10 Tf 12 TL 10 90 Td (A) Tj T* (B) Tj (C) \' 1 2 (D) " ET')
    expect(lines.drawn.map((d) => at(d))).toEqual([[10, 10], [10, 22], [10, 34], [10, 46]])
    // TD sets the leading from its y offset
    const td = await shown(SIMPLE, 'BT /F1 10 Tf 0 -15 TD (A) Tj T* (B) Tj ET')
    expect(td.drawn.map((d) => d.matrix[5])).toEqual([115, 130])
    // " also sets word and character spacing
    const dq = await shown(SIMPLE, 'BT /F1 10 Tf 12 TL 0 0 Td 5 1 (A B) " ET')
    expect(dq.drawn[1].matrix[4]).toBe(5 + 1 + 5 + 1 + 5 === 17 ? 17 : dq.drawn[1].matrix[4])
  })

  test('Tm sets the matrix outright and scales the glyphs', async () => {
    const { drawn } = await shown(SIMPLE, 'BT /F1 10 Tf 2 0 0 3 20 30 Tm (A) Tj ET')
    expect(drawn[0].matrix).toEqual([2 * K, 0, 0, 3 * K, 20, 70])
  })

  test('render modes: 3 is invisible but still advances; 1 strokes; 2 does both', async () => {
    const hidden = await shown(SIMPLE, 'BT /F1 10 Tf 3 Tr (A) Tj 0 Tr (B) Tj ET')
    expect(hidden.drawn.map((d) => d.text)).toEqual(['B'])
    expect(hidden.drawn[0].matrix[4]).toBe(5)
    const stroked = await shown(SIMPLE, 'BT /F1 10 Tf 1 Tr (A) Tj ET')
    expect(stroked.drawn.map((d) => d.text)).toEqual(['stroke:A'])
    const both = await shown(SIMPLE, 'BT /F1 10 Tf 2 Tr (A) Tj ET')
    expect(both.drawn.map((d) => d.text)).toEqual(['A', 'stroke:A'])
  })

  test('clip render modes are reported rather than silently ignored', async () => {
    const { result } = await shown(SIMPLE, 'BT /F1 10 Tf 7 Tr (A) Tj ET')
    expect(result.warnings).toContain("Text used as a clipping path isn't applied")
  })

  test('text is filled with the current colour, alpha and blend', async () => {
    const { calls } = await shown(SIMPLE, '1 0 0 rg BT /F1 10 Tf (A) Tj ET')
    const fillAt = calls.findIndex((c) => c[0] === 'fillText')
    expect(calls.slice(0, fillAt).filter((c) => c[0] === 'set' && c[1] === 'fillStyle').at(-1)![2]).toBe('rgb(255,0,0)')
    expect(calls.slice(fillAt).find((c) => c[0] === 'set' && c[1] === 'globalAlpha')![2]).toBe(1) // reset afterwards
  })

  test('after Q the canvas has forgotten its font, so the next text sets it again (Quartz wraps every line in q ... Q)', async () => {
    const { calls, drawn } = await shown(SIMPLE, 'q BT /F1 10 Tf (A) Tj ET Q q BT /F1 10 Tf (B) Tj ET Q BT /F1 10 Tf (C) Tj ET')
    expect(drawn.map((d) => d.text)).toEqual(['A', 'B', 'C'])
    // each fillText is preceded by a font assignment made since the last restore
    let ok = true
    let fontSet = false
    for (const c of calls) {
      if (c[0] === 'restore') fontSet = false
      if (c[0] === 'set' && c[1] === 'font') fontSet = true
      if (c[0] === 'fillText' && !fontSet) ok = false
    }
    expect(ok).toBe(true)
  })

  test('the text state is saved and restored by q and Q, the text matrix is not', async () => {
    const { drawn } = await shown(SIMPLE, 'BT /F1 10 Tf q 4 Tc Q (AB) Tj ET')
    expect(drawn[1].matrix[4]).toBe(5) // Tc went back to 0
    const tm = await shown(SIMPLE, 'BT /F1 10 Tf 10 0 Td q (A) Tj Q (B) Tj ET')
    expect(tm.drawn[1].matrix[4]).toBe(15) // B continues after A: the text matrix survives Q
  })

  test('spaces and glyphs with no character are not drawn; a code outside /Widths has width 0', async () => {
    const { drawn } = await shown(SIMPLE, 'BT /F1 10 Tf ( A\x01B) Tj ET')
    expect(drawn.map((d) => d.text)).toEqual(['A', 'B'])
    expect(drawn[0].matrix[4]).toBe(5) // after the space
    expect(drawn[1].matrix[4]).toBe(10) // code 1 is outside the /Widths table and there is no /MissingWidth: zero wide
    const wide = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 32 /LastChar 126 /Widths [' + Array(95).fill(500).join(' ') + '] /FontDescriptor << /MissingWidth 300 >> >>'
    expect((await shown(wide, 'BT /F1 10 Tf (\x01B) Tj ET')).drawn[0].matrix[4]).toBe(3) // MissingWidth 300 at 10 pt
  })

  test('glyphs are squeezed or stretched to the PDF width when the stand-in font differs', async () => {
    // 1000 units is a whole em, but the fake canvas says the character is half an em: stretch by 2
    const wide = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 65 /LastChar 65 /Widths [1000] >>'
    const { drawn } = await shown(wide, 'BT /F1 10 Tf (A) Tj ET')
    expect(drawn[0].matrix[0]).toBe(2 * K)
    const narrow = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 65 /LastChar 65 /Widths [250] >>'
    expect((await shown(narrow, 'BT /F1 10 Tf (A) Tj ET')).drawn[0].matrix[0]).toBe(0.5 * K)
  })

  test('without /Widths the canvas measurement decides the advance', async () => {
    const bare = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    const { drawn } = await shown(bare, 'BT /F1 10 Tf (AB) Tj ET')
    expect(drawn[1].matrix[4]).toBe(5) // the fake measures 5 px per character
  })

  test('Quartz style: font size 1 with the size in the text matrix still draws at full size, upright', async () => {
    // "12 0 0 12 20 30 Tm /F1 1 Tf": the canvas font must not be 1px, and the glyph matrix puts the size back
    const { drawn, prop, calls } = await shown(SIMPLE, 'BT 12 0 0 12 20 30 Tm /F1 1 Tf (AB) Tj ET')
    expect(prop('font', calls.length)).toMatch(/^16px /)
    expect(drawn[0].matrix).toEqual([12 / 16, 0, 0, 12 / 16, 20, 70])
    expect(drawn[1].matrix[4]).toBeCloseTo(20 + 6) // 500 units of a 12 pt em
  })

  test('big text is drawn at most 100px and scaled up', async () => {
    const { drawn, prop, calls } = await shown(SIMPLE, 'BT /F1 200 Tf (A) Tj ET')
    expect(prop('font', calls.length)).toMatch(/^100px /)
    expect(drawn[0].matrix[0]).toBe(2)
  })

  test('a missing font falls back to a default and says so; bad operands do not crash', async () => {
    const { result, drawn } = await shown(SIMPLE, 'BT /Nope 10 Tf (A) Tj 12 Tj [1 2] TJ () Tj ET')
    expect(result.warnings).toContain('A font is missing; a default one is used')
    expect(drawn.map((d) => d.text)).toEqual(['A'])
  })
})

describe('character mapping', () => {
  test('/Differences glyph names win over the base encoding', async () => {
    const font = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 65 /LastChar 67 /Widths [500 500 500] /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [65 /Euro /eacute 67 /uni00DF] >> >>'
    const { drawn } = await shown(font, 'BT /F1 10 Tf (ABC) Tj ET')
    expect(drawn.map((d) => d.text)).toEqual(['€', 'é', 'ß'])
  })

  test('named base encodings: MacRoman reads 0x8E as e-acute where WinAnsi reads it as z-caron', async () => {
    const mk = (enc: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /FirstChar 142 /LastChar 142 /Widths [500] /Encoding /${enc} >>`
    expect((await shown(mk('MacRomanEncoding'), 'BT /F1 10 Tf (\x8e) Tj ET')).drawn[0].text).toBe('é')
    expect((await shown(mk('WinAnsiEncoding'), 'BT /F1 10 Tf (\x8e) Tj ET')).drawn[0].text).toBe('Ž')
  })

  test('a glyph name we cannot resolve falls back to ToUnicode', async () => {
    const font = '<< /Type /Font /Subtype /Type1 /BaseFont /ABCDEF+Sub /FirstChar 1 /LastChar 1 /Widths [500] /Encoding << /Differences [1 /g27] >> /ToUnicode 11 0 R >>'
    const { drawn } = await shown(font, 'BT /F1 10 Tf (\x01) Tj ET', { 11: stream('', '1 beginbfchar <01> <0058> endbfchar') })
    expect(drawn[0].text).toBe('X')
  })

  test('a CID font: two-byte codes, ToUnicode for the text, /W and /DW for the advances', async () => {
    const font = '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Calibri /Encoding /Identity-H /DescendantFonts [12 0 R] /ToUnicode 11 0 R >>'
    const objects = {
      11: stream('', '1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <0048> <0002> <0069> endbfchar'),
      12: '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+Calibri /DW 600 /W [1 [500] ] /FontDescriptor 13 0 R >>',
      13: '<< /Type /FontDescriptor /FontName /ABCDEF+Calibri /Flags 32 >>',
    }
    const { drawn, result } = await shown(font, 'BT /F1 10 Tf <00010002> Tj ET', objects)
    expect(drawn.map((d) => d.text)).toEqual(['H', 'i'])
    expect(drawn[1].matrix[4]).toBeCloseTo(5) // code 1 is 500 wide
    expect(result.warnings).toContain('Fonts are shown with similar ones')
  })

  test('a /W range applies to every code in it', async () => {
    const doc = await withFont('<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [12 0 R] >>', '', {
      12: '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X /DW 1000 /W [5 7 250 9 [100 200]] >>',
    })
    const font = await loadFont(doc, doc.objects.get(10)!)
    const widths = font.decode(Uint8Array.of(0, 5, 0, 7, 0, 8, 0, 9, 0, 10)).map((g) => g.width)
    expect(widths).toEqual([250, 250, 1000, 100, 200])
  })

  test('code lengths other than two are honoured when the ToUnicode says so', async () => {
    const doc = await withFont('<< /Type /Font /Subtype /Type0 /BaseFont /X /Encoding /Identity-H /DescendantFonts [12 0 R] /ToUnicode 11 0 R >>', '', {
      11: stream('', '1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <0041> endbfchar'),
      12: '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /X >>',
    })
    const font = await loadFont(doc, doc.objects.get(10)!)
    expect(font.decode(Uint8Array.of(0x41, 0x41)).map((g) => g.text)).toEqual(['A', 'A'])
  })
})

describe('Type 3 fonts', () => {
  const font = '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /sq 11 0 R >> /Encoding << /Type /Encoding /Differences [97 /sq] >> /FirstChar 97 /LastChar 97 /Widths [1000] >>'
  const objects = { 11: stream('', '1000 0 0 0 1000 1000 d1 0 0 1000 1000 re f') }

  test('the glyph procedure is drawn in glyph space scaled by the font matrix and size, then advances', async () => {
    const { calls, all } = await shown(font, 'BT /F1 10 Tf 5 5 Td (aa) Tj ET', objects)
    expect(all('rect')).toEqual([[0, 0, 1000, 1000], [0, 0, 1000, 1000]])
    const tfs = calls.filter((c) => c[0] === 'setTransform').map((c) => c.slice(1) as number[])
    const glyph = tfs.filter((t) => Math.abs(t[0] - 0.01) < 1e-9)
    expect(glyph.length).toBeGreaterThanOrEqual(2)
    // first glyph origin: text position (5,5) -> device (5, 95); the second is one glyph width (10 units) to the right
    expect(glyph[0].slice(4)).toEqual([5, 95])
    expect(glyph[1][4] - glyph[0][4]).toBeCloseTo(10)
    expect(all('fill')).toHaveLength(2)
  })

  test('a glyph that has no procedure is skipped without breaking the line', async () => {
    const { all } = await shown(font, 'BT /F1 10 Tf (abz) Tj ET', objects)
    expect(all('rect')).toHaveLength(1)
  })
})
