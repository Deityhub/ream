import { describe, expect, test } from 'vitest'
import { PdfName, PdfStream, decodeStream, decodeUntilImage, deflate, type PdfObj } from '../src/index.ts'
import { asciiHexDecode, ascii85Decode, lzwDecode, runLengthDecode, tiffPredictor } from '../src/filters.ts'

const enc = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array) => new TextDecoder().decode(b)
const stream = (data: Uint8Array, filter: PdfObj, parms?: PdfObj) =>
  new PdfStream(new Map<string, PdfObj>([['Filter', filter], ...(parms ? ([['DecodeParms', parms]] as [string, PdfObj][]) : [])]), data)
const name = (n: string) => new PdfName(n)

describe('byte filters', () => {
  test('ASCIIHex: whitespace ignored, odd digit padded, ends at >', () => {
    expect(text(asciiHexDecode(enc('48 65 6C 6c 6F>garbage')))).toBe('Hello')
    expect(Array.from(asciiHexDecode(enc('4>')))).toEqual([0x40])
  })

  test('ASCII85: the Wikipedia sample, z shortcut, partial group', () => {
    expect(text(ascii85Decode(enc('9jqo^BlbD-BleB1DJ+*+F(f,q~>')))).toBe('Man is distinguished')
    expect(Array.from(ascii85Decode(enc('z~>')))).toEqual([0, 0, 0, 0])
    expect(text(ascii85Decode(enc('<~'.slice(2) + '87cURD]i,"Ebo80~>')))).toBe('Hello World!')
  })

  test('RunLength: literal runs, repeat runs and EOD', () => {
    expect(Array.from(runLengthDecode(Uint8Array.of(2, 1, 2, 3, 254, 9, 128, 99)))).toEqual([1, 2, 3, 9, 9, 9])
  })

  test('LZW: the example from the PDF spec (9-bit codes, EarlyChange 1)', () => {
    // 45 45 45 45 45 65 45 45 45 66 -> codes 256 45 258 258 65 259 66 257
    const codes = [256, 45, 258, 258, 65, 259, 66, 257]
    let bits = ''
    for (const c of codes) bits += c.toString(2).padStart(9, '0')
    bits = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0')
    const bytes = Uint8Array.from(bits.match(/.{8}/g)!, (b) => parseInt(b, 2))
    expect(Array.from(lzwDecode(bytes))).toEqual([45, 45, 45, 45, 45, 65, 45, 45, 45, 66])
  })

  test('LZW survives growing past 9-bit codes', () => {
    // encode a long run with a tiny reference LZW encoder, then decode it again
    const input = Uint8Array.from({ length: 3000 }, (_, i) => (i * 7 + (i >> 3)) & 255)
    const dict = new Map<string, number>()
    for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i)
    const codes: number[] = [256]
    let w = ''
    for (const b of input) {
      const c = String.fromCharCode(b)
      if (dict.has(w + c)) w += c
      else {
        codes.push(dict.get(w)!)
        dict.set(w + c, dict.size + 2)
        w = c
        if (dict.size + 2 >= 4094) { codes.push(256); dict.clear(); for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i) }
      }
    }
    if (w) codes.push(dict.get(w)!)
    codes.push(257)
    // pack with the width the decoder expects after each added entry (EarlyChange 1)
    let bits = ''
    let next = 258
    let width = 9
    let first = true
    for (const c of codes) {
      bits += c.toString(2).padStart(width, '0')
      if (c === 256) { next = 258; width = 9; first = true; continue }
      if (c === 257) break
      if (!first) next++
      first = false
      width = next + 1 >= 2048 ? 12 : next + 1 >= 1024 ? 11 : next + 1 >= 512 ? 10 : 9
    }
    bits = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0')
    const packed = Uint8Array.from(bits.match(/.{8}/g)!, (b) => parseInt(b, 2))
    expect(Array.from(lzwDecode(packed))).toEqual(Array.from(input))
  })

  test('TIFF predictor adds each sample to the one on its left', () => {
    expect(Array.from(tiffPredictor(Uint8Array.of(10, 1, 1, 1, 5, 2, 2, 2), 4, 1))).toEqual([10, 11, 12, 13, 5, 7, 9, 11])
    expect(Array.from(tiffPredictor(Uint8Array.of(1, 2, 3, 1, 1, 1), 2, 3))).toEqual([1, 2, 3, 2, 3, 4])
  })
})

describe('decodeStream filter chains', () => {
  test('ASCII85 then Flate, written as an array of filters', async () => {
    const z = await deflate(enc('chained'))
    // ascii85-encode z by hand
    let out = ''
    for (let i = 0; i < z.length; i += 4) {
      const chunk = z.subarray(i, i + 4)
      let v = 0
      for (let k = 0; k < 4; k++) v = v * 256 + (chunk[k] ?? 0)
      const g: string[] = []
      for (let k = 0; k < 5; k++) { g.unshift(String.fromCharCode((v % 85) + 33)); v = Math.floor(v / 85) }
      out += g.slice(0, chunk.length + 1).join('')
    }
    const s = stream(enc(out + '~>'), [name('ASCII85Decode'), name('FlateDecode')])
    expect(text(await decodeStream(s))).toBe('chained')
  })

  test('Flate data followed by a stray byte (a line break counted in Length) still decodes; garbage alone is damaged', async () => {
    const z = await deflate(enc('trailing'))
    expect(text(await decodeStream(stream(Uint8Array.from([...z, 10]), name('FlateDecode'))))).toBe('trailing')
    await expect(decodeStream(stream(enc('not flate at all'), name('FlateDecode')))).rejects.toThrow(/damaged/)
  })

  test('image filters stop the chain and report what is left', async () => {
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
    const d = await decodeUntilImage(stream(await deflate(jpeg), [name('FlateDecode'), name('DCTDecode')]))
    expect(Array.from(d.data)).toEqual(Array.from(jpeg))
    expect(d.rest?.filter).toBe('DCTDecode')
    await expect(decodeStream(stream(jpeg, name('DCTDecode')))).rejects.toThrow('Unsupported stream filter DCTDecode')
  })

  test('a PNG predictor after LZW or Flate is applied', async () => {
    const raw = Uint8Array.of(2, 10, 20, 2, 1, 1) // Up filter rows of 2 bytes
    const s = stream(await deflate(raw), name('FlateDecode'), new Map<string, PdfObj>([['Predictor', 12], ['Columns', 2]]))
    expect(Array.from(await decodeStream(s))).toEqual([10, 20, 11, 21])
  })

  test('unknown filters are reported by name', async () => {
    await expect(decodeStream(stream(new Uint8Array(1), name('Wobble')))).rejects.toThrow('Unsupported stream filter Wobble')
  })
})
