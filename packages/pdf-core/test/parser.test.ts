import { expect, test } from 'vitest'
import { Parser, PdfName, PdfRef, PdfString, decodeStream, deflate, PdfStream, type PdfObj } from '../src/index.ts'
import { ascii, latin1 } from '../src/bytes.ts'
import { parseIndirectAt } from '../src/parser.ts'

const parse = (s: string) => new Parser(ascii(s)).readValue()

test('numbers, keywords and refs', () => {
  expect(parse('42')).toBe(42)
  expect(parse('-3.5')).toBe(-3.5)
  expect(parse('+.5')).toBe(0.5)
  expect(parse('true')).toBe(true)
  expect(parse('null')).toBe(null)
  const arr = parse('[1 0 R 2 0 R 3 4 /N]') as unknown[]
  expect(arr[0]).toEqual(new PdfRef(1, 0))
  expect(arr[1]).toEqual(new PdfRef(2, 0))
  expect(arr.slice(2)).toEqual([3, 4, new PdfName('N')])
})

test('names with #xx escapes', () => {
  expect((parse('/A#20B') as PdfName).value).toBe('A B')
})

test('literal strings: escapes, octal, nesting, line continuation', () => {
  const s = parse('(a\\(b\\)c (nested) \\101\\n\\\\ x\\\ny)') as PdfString
  expect(latin1(s.bytes)).toBe('a(b)c (nested) A\n\\ xy')
})

test('hex strings, odd digit count pads with 0', () => {
  expect(latin1((parse('<48656C6C6F>') as PdfString).bytes)).toBe('Hello')
  expect(Array.from((parse('<4>') as PdfString).bytes)).toEqual([0x40])
})

test('dicts nest, comments are skipped, missing last value tolerated', () => {
  const d = parse('<< /A 1 % ignore me\n /B << /C [1 2] >> /D >>') as Map<string, unknown>
  expect(d.get('A')).toBe(1)
  expect((d.get('B') as Map<string, unknown>).get('C')).toEqual([1, 2])
  expect(d.get('D')).toBe(null)
})

test('stream with a wrong /Length falls back to scanning for endstream', () => {
  const data = ascii('7 0 obj\n<< /Length 2 >>\nstream\nhello world\nendstream\nendobj\n')
  const r = parseIndirectAt(data, 0, (o) => (typeof o === 'number' ? o : NaN))
  expect(latin1((r.obj as PdfStream).data)).toBe('hello world')
})

test('flate + PNG predictor round trip', async () => {
  // rows of 3 bytes with the "Up" filter: second row stores the difference to the first
  const raw = Uint8Array.of(2, 10, 20, 30, 2, 1, 1, 1)
  const s = new PdfStream(
    new Map<string, PdfObj>([
      ['Filter', new PdfName('FlateDecode')],
      ['DecodeParms', new Map<string, PdfObj>([['Predictor', 12], ['Columns', 3]])],
    ]),
    await deflate(raw),
  )
  expect(Array.from(await decodeStream(s))).toEqual([10, 20, 30, 11, 21, 31])
})
