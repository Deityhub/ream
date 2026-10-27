import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfName, PdfRef, PdfStream, PdfString, deflate, type PdfDict, type PdfObj } from '@ream/pdf-core'
import { loadFunction } from '../src/function.ts'
import { DeviceCMYK, DeviceGray, DeviceRGB, css, loadColorSpace } from '../src/color.ts'

const name = (n: string) => new PdfName(n)
const d = (entries: Record<string, PdfObj>): PdfDict => new Map(Object.entries(entries))
const enc = (s: string) => new TextEncoder().encode(s)

/** a PdfDocument over a hand-made object table, enough for resolve() */
const doc = (objects: Record<number, PdfObj> = {}) =>
  new PdfDocument(new Map(Object.entries(objects).map(([k, v]) => [Number(k), v])), new Map())

const calc = (program: string, domain: number[], range: number[]) =>
  new PdfStream(d({ FunctionType: 4, Domain: domain, Range: range }), enc(program))

describe('functions', () => {
  test('type 2 interpolates between C0 and C1 with exponent N', async () => {
    const f = (await loadFunction(doc(), d({ FunctionType: 2, Domain: [0, 1], C0: [0, 1], C1: [1, 0], N: 1 })))!
    expect(f([0.25])).toEqual([0.25, 0.75])
    const sq = (await loadFunction(doc(), d({ FunctionType: 2, Domain: [0, 1], N: 2 })))!
    expect(sq([0.5])).toEqual([0.25])
    expect(sq([5])).toEqual([1]) // input clipped to the domain
  })

  test('type 3 stitches sub-functions and re-encodes the input', async () => {
    const low = d({ FunctionType: 2, Domain: [0, 1], C0: [0], C1: [10], N: 1 })
    const high = d({ FunctionType: 2, Domain: [0, 1], C0: [100], C1: [200], N: 1 })
    const f = (await loadFunction(doc(), d({ FunctionType: 3, Domain: [0, 1], Functions: [low, high], Bounds: [0.5], Encode: [0, 1, 0, 1] })))!
    expect(f([0.25])).toEqual([5])
    expect(f([0.5])).toEqual([100])
    expect(f([0.75])).toEqual([150])
    expect(f([1])).toEqual([200])
  })

  test('type 0 interpolates a table of samples', async () => {
    // 3 samples of 8 bits: 0, 255, 0 -> a triangle
    const s = new PdfStream(d({ FunctionType: 0, Domain: [0, 1], Range: [0, 1], Size: [3], BitsPerSample: 8 }), Uint8Array.of(0, 255, 0))
    const f = (await loadFunction(doc(), s))!
    expect(f([0])[0]).toBeCloseTo(0)
    expect(f([0.5])[0]).toBeCloseTo(1)
    expect(f([0.25])[0]).toBeCloseTo(0.5)
    expect(f([1])[0]).toBeCloseTo(0)
  })

  test('type 0 with two inputs interpolates in both directions', async () => {
    // 2x2 grid, one output: corners 0,1 (first row) and 1,0 (second row)
    const s = new PdfStream(d({ FunctionType: 0, Domain: [0, 1, 0, 1], Range: [0, 1], Size: [2, 2], BitsPerSample: 8 }), Uint8Array.of(0, 255, 255, 0))
    const f = (await loadFunction(doc(), s))!
    expect(f([0, 0])[0]).toBeCloseTo(0)
    expect(f([1, 0])[0]).toBeCloseTo(1)
    expect(f([0, 1])[0]).toBeCloseTo(1)
    expect(f([0.5, 0.5])[0]).toBeCloseTo(0.5)
  })

  describe('type 4 (PostScript calculator)', () => {
    const run = async (program: string, inputs: number[], domain: number[], range: number[]) =>
      (await loadFunction(doc(), calc(program, domain, range)))!(inputs)

    test('arithmetic and stack operators', async () => {
      expect(await run('{ 2 mul 1 add }', [3], [0, 10], [0, 100])).toEqual([7])
      expect(await run('{ dup mul }', [4], [0, 10], [0, 100])).toEqual([16])
      expect(await run('{ exch sub }', [2, 5], [0, 10, 0, 10], [-10, 10])).toEqual([3])
      expect(await run('{ 3 1 roll }', [1, 2, 3], [0, 9, 0, 9, 0, 9], [0, 9, 0, 9, 0, 9])).toEqual([3, 1, 2])
      expect(await run('{ 3 -1 roll }', [1, 2, 3], [0, 9, 0, 9, 0, 9], [0, 9, 0, 9, 0, 9])).toEqual([2, 3, 1])
      expect(await run('{ 1 index add }', [1, 2], [0, 9, 0, 9], [0, 9, 0, 9])).toEqual([1, 3])
    })

    test('if and ifelse, comparisons', async () => {
      const ifelse = '{ dup 0.5 gt { pop 1 } { pop 0 } ifelse }'
      expect(await run(ifelse, [0.8], [0, 1], [0, 1])).toEqual([1])
      expect(await run(ifelse, [0.2], [0, 1], [0, 1])).toEqual([0])
      expect(await run('{ dup 0.5 lt { 2 mul } if }', [0.25], [0, 1], [0, 1])).toEqual([0.5])
    })

    test('math functions and the output range clip', async () => {
      expect(await run('{ 90 sin }', [0], [0, 1], [0, 1])).toEqual([1])
      expect((await run('{ 16 sqrt }', [0], [0, 1], [0, 10]))[0]).toBe(4)
      expect(await run('{ 5 mul }', [1], [0, 1], [0, 2])).toEqual([2]) // 5 clipped to the range
      expect(await run('{ 7 3 idiv 7 3 mod }', [0], [0, 1], [0, 9, 0, 9])).toEqual([2, 1])
    })

    test('a typical CMYK tint transform (one ink in, four out)', async () => {
      const out = await run('{ dup 0.2 mul exch dup 0 mul exch 0.9 mul 0 }', [1], [0, 1], [0, 1, 0, 1, 0, 1, 0, 1])
      expect(out).toHaveLength(4)
    })
  })
})

describe('colour spaces', () => {
  test('device spaces', () => {
    expect(DeviceGray.rgb([0.5])).toEqual([128, 128, 128])
    expect(DeviceRGB.rgb([1, 0, 0.5])).toEqual([255, 0, 128])
    // CMYK follows a print profile, so pure inks are not the screen primaries: no ink is white, cyan is a mid blue-green
    expect(DeviceCMYK.rgb([0, 0, 0, 0])).toEqual([255, 255, 255])
    const [kr, kg, kb] = DeviceCMYK.rgb([0, 0, 0, 1])
    expect(Math.max(kr, kg, kb)).toBeLessThan(70) // near black, not pure
    const [cr, cg, cb] = DeviceCMYK.rgb([1, 0, 0, 0])
    expect(cr).toBeLessThan(15)
    expect(cg).toBeGreaterThan(140)
    expect(cg).toBeLessThan(215)
    expect(cb).toBeGreaterThan(190)
    expect(css([1, 2, 3])).toBe('rgb(1,2,3)')
  })

  test('names resolve through the resources dictionary', async () => {
    const res = d({ ColorSpace: d({ CS0: [name('ICCBased'), new PdfRef(5)] }) })
    const icc = new PdfStream(d({ N: 4 }), new Uint8Array(0))
    const cs = await loadColorSpace(doc({ 5: icc }), name('CS0'), res)
    expect(cs.n).toBe(4)
    const [r, g, b] = cs.rgb([0, 1, 0, 0]) // magenta ink
    expect(r).toBeGreaterThan(200)
    expect(g).toBeLessThan(90)
    expect(b).toBeGreaterThan(100)
  })

  test('ICCBased uses N when there is no alternate', async () => {
    const mk = async (n: number) => (await loadColorSpace(doc({ 1: new PdfStream(d({ N: n }), new Uint8Array(0)) }), [name('ICCBased'), new PdfRef(1)] as PdfObj)).name
    expect(await mk(1)).toBe('DeviceGray')
    expect(await mk(3)).toBe('DeviceRGB')
    expect(await mk(4)).toBe('DeviceCMYK')
  })

  test('Indexed looks colours up in the palette', async () => {
    const cs = await loadColorSpace(doc(), [name('Indexed'), name('DeviceRGB'), 2, new PdfString(Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255))] as PdfObj)
    expect(cs.rgb([0])).toEqual([255, 0, 0])
    expect(cs.rgb([1])).toEqual([0, 255, 0])
    expect(cs.rgb([2])).toEqual([0, 0, 255])
    expect(cs.rgb([9])).toEqual([0, 0, 255]) // beyond hival is clamped
    expect(cs.range).toEqual([[0, 2]])
  })

  test('Indexed palette stored in a compressed stream', async () => {
    const pal = new PdfStream(d({ Filter: name('FlateDecode') }), await deflate(Uint8Array.of(10, 20, 30, 40, 50, 60)))
    const cs = await loadColorSpace(doc({ 7: pal }), [name('Indexed'), name('DeviceRGB'), 1, new PdfRef(7)] as PdfObj)
    expect(cs.rgb([1])).toEqual([40, 50, 60])
  })

  test('Separation applies its tint transform to the alternate space', async () => {
    const tint = d({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 1, 1, 0], N: 1 }) // spot "red" in CMYK
    const cs = await loadColorSpace(doc(), [name('Separation'), name('PANTONE'), name('DeviceCMYK'), tint] as PdfObj)
    expect(cs.n).toBe(1)
    const [r, g, b] = cs.rgb([1]) // red + yellow ink: a warm red
    expect(r).toBeGreaterThan(240)
    expect(g).toBeLessThan(90)
    expect(b).toBeLessThan(70)
    expect(cs.rgb([0])).toEqual([255, 255, 255])
    expect(cs.initial).toEqual([1])
  })

  test('DeviceN has one component per colorant', async () => {
    const tint = d({ FunctionType: 4, Domain: [0, 1, 0, 1], Range: [0, 1, 0, 1, 0, 1] })
    const fn = new PdfStream(tint, enc('{ 0 }'))
    const cs = await loadColorSpace(doc(), [name('DeviceN'), [name('A'), name('B')], name('DeviceRGB'), fn] as PdfObj)
    expect(cs.n).toBe(2)
  })

  test('Lab: L=100 is white, L=0 is black, mid grey stays neutral', async () => {
    const cs = await loadColorSpace(doc(), [name('Lab'), d({ WhitePoint: [0.9642, 1, 0.8249], Range: [-128, 127, -128, 127] })] as PdfObj)
    expect(cs.rgb([100, 0, 0]).every((v) => v >= 252)).toBe(true)
    expect(cs.rgb([0, 0, 0])).toEqual([0, 0, 0])
    const [r, g, b] = cs.rgb([50, 0, 0])
    expect(Math.abs(r - g) + Math.abs(g - b)).toBeLessThan(12)
    expect(g).toBeGreaterThan(100)
    expect(g).toBeLessThan(140)
  })

  test('unknown or missing spaces fall back to gray instead of throwing', async () => {
    expect((await loadColorSpace(doc(), name('Nope'), d({}))).name).toBe('DeviceGray')
    expect((await loadColorSpace(doc(), undefined)).name).toBe('DeviceGray')
  })
})
