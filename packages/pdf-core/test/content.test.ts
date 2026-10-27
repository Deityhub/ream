import { describe, expect, test } from 'vitest'
import { scanContent, usedResources } from '../src/index.ts'
import { ascii, latin1 } from '../src/bytes.ts'

const ops = (s: string) => scanContent(ascii(s))
const texts = (s: string) => ops(s).map((o) => s.slice(o.start, o.end))

describe('scanContent', () => {
  test('every operator comes with the exact bytes of its operands and itself', () => {
    const s = 'q 1 0 0 1 5 5 cm\n/F1 12 Tf (a b) Tj  [ (x) -20 (y) ] TJ\nQ'
    expect(ops(s).map((o) => o.op)).toEqual(['q', 'cm', 'Tf', 'Tj', 'TJ', 'Q'])
    expect(texts(s)).toEqual(['q', '1 0 0 1 5 5 cm', '/F1 12 Tf', '(a b) Tj', '[ (x) -20 (y) ] TJ', 'Q'])
  })
  test('removing ranges leaves the rest byte for byte', () => {
    const s = '0 0 10 10 re f % a comment\n20 20 5 5 re f\n'
    const f1 = ops(s).find((o) => o.op === 'f')!
    expect(s.slice(0, f1.start) + s.slice(f1.end)).toBe('0 0 10 10 re  % a comment\n20 20 5 5 re f\n')
  })
  test('strings with escapes and parentheses do not confuse the scan', () => {
    const s = '(a \\) b (nested)) Tj /X Do'
    expect(texts(s)).toEqual(['(a \\) b (nested)) Tj', '/X Do'])
  })
  test('an inline image is one operator, even when its data looks like operators', () => {
    const data = 'q Q EI x' // 8 bytes of grey pixels that contain the letters EI
    const s = `q 4 0 0 2 0 0 cm BI /W 4 /H 2 /CS /G /BPC 8 ID ${data} EI Q /F Do`
    const list = ops(s)
    expect(list.map((o) => o.op)).toEqual(['q', 'cm', 'BI', 'Q', 'Do'])
    expect(s.slice(list[2].start, list[2].end).startsWith('BI /W 4')).toBe(true)
    expect(s.slice(list[2].start, list[2].end).endsWith(' EI')).toBe(true)
  })
  test('unreadable bytes are skipped like the renderer does', () => {
    expect(ops('1 0 0 rg ) ] 5 5 re f').map((o) => o.op)).toContain('f')
  })
  test('binary data is handled without touching it', () => {
    const bytes = Uint8Array.from([...ascii('q BI /W 1 /H 1 /CS /G /BPC 8 ID '), 0xff, ...ascii(' EI Q')])
    expect(scanContent(bytes).map((o) => o.op)).toEqual(['q', 'BI', 'Q'])
    expect(latin1(bytes.subarray(0, 1))).toBe('q')
  })
})

describe('usedResources', () => {
  test('names by kind', () => {
    const u = usedResources(ops('/GS1 gs /F1 9 Tf /Im1 Do /Fm Do /Sh sh /Cs1 cs /DeviceRGB cs /Pattern cs 0.5 /P1 scn /OC /MC1 BDC'))
    expect(Object.fromEntries(Object.entries(u.names).map(([k, v]) => [k, [...v].sort()]))).toEqual({
      ExtGState: ['GS1'], Font: ['F1'], XObject: ['Fm', 'Im1'], Shading: ['Sh'], ColorSpace: ['Cs1'], Pattern: ['P1'], Properties: ['MC1'],
    })
    expect(u.inlineImages).toBe(false)
  })
  test('inline images are noted', () => {
    expect(usedResources(ops('BI /W 1 /H 1 /CS /G /BPC 8 ID A EI')).inlineImages).toBe(true)
  })
})
