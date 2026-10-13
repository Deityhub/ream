import { describe, expect, test } from 'vitest'
import { UserError } from '@ream/core'
import { createImage, crop, flattenOnWhite, flip, resize, rotate, stitch, type ImageBuffer } from '../src/index.ts'

/** image whose pixel (x, y) is fn(x, y) = [r, g, b, a] */
const make = (w: number, h: number, fn: (x: number, y: number) => number[]): ImageBuffer => {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set(fn(x, y), (y * w + x) * 4)
  return img
}
const px = (img: ImageBuffer, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4))
const solid = (w: number, h: number, c: number[]) => make(w, h, () => c)

describe('resize', () => {
  test('same size returns an equal copy', () => {
    const a = make(3, 2, (x, y) => [x * 40, y * 90, 7, 255])
    const b = resize(a, 3, 2)
    expect(b.data).toEqual(a.data)
    expect(b.data).not.toBe(a.data)
  })

  test('a solid colour stays that colour, up and down', () => {
    for (const [w, h] of [[2, 2], [16, 16], [3, 7]]) {
      const out = resize(solid(8, 8, [10, 200, 90, 255]), w, h)
      expect(out.width).toBe(w)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect(px(out, x, y)).toEqual([10, 200, 90, 255])
    }
  })

  test('a horizontal gradient stays monotonic when shrunk', () => {
    const out = resize(make(64, 4, (x) => [x * 4, x * 4, x * 4, 255]), 8, 2)
    const row = Array.from({ length: 8 }, (_, x) => px(out, x, 0)[0])
    expect(row).toEqual([...row].sort((a, b) => a - b))
    expect(row[0]).toBeLessThan(30)
    expect(row[7]).toBeGreaterThan(225)
  })

  test('transparent pixels do not darken the colour next to them', () => {
    // left half opaque red, right half fully transparent black
    const out = resize(make(8, 8, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 0, 0, 0])), 4, 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const [r, g, b, a] = px(out, x, y)
        if (a > 20) {
          expect(r).toBeGreaterThan(240)
          expect(g + b).toBeLessThan(10)
        }
      }
    }
    expect(px(out, 0, 0)[3]).toBe(255)
    expect(px(out, 3, 0)[3]).toBe(0)
  })

  test('bad sizes are refused', () => {
    expect(() => resize(solid(2, 2, [0, 0, 0, 255]), 0, 5)).toThrow(UserError)
    expect(() => resize(solid(2, 2, [0, 0, 0, 255]), 1.5, 5)).toThrow(UserError)
    expect(() => resize(solid(2, 2, [0, 0, 0, 255]), 20000, 20000)).toThrow(/megapixels/)
  })
})

describe('crop', () => {
  const a = make(4, 3, (x, y) => [x, y, 0, 255])
  test('takes the right pixels', () => {
    const c = crop(a, 1, 1, 2, 2)
    expect([c.width, c.height]).toEqual([2, 2])
    expect(px(c, 0, 0)).toEqual([1, 1, 0, 255])
    expect(px(c, 1, 1)).toEqual([2, 2, 0, 255])
  })
  test('refuses areas outside the image', () => {
    const bad: [number, number, number, number][] = [[0, 0, 5, 1], [-1, 0, 1, 1], [3, 2, 2, 2], [0, 0, 0, 1], [0.5, 0, 1, 1]]
    for (const args of bad) {
      expect(() => crop(a, ...args)).toThrow(UserError)
    }
  })
})

describe('rotate and flip', () => {
  const a = make(4, 2, (x, y) => [x * 10, y * 100, 0, 255])
  test('one clockwise turn moves (x, y) to (h-1-y, x) and swaps the size', () => {
    const r = rotate(a, 1)
    expect([r.width, r.height]).toEqual([2, 4])
    expect(px(r, 2 - 1 - 0, 3)).toEqual(px(a, 3, 0)) // marker pixel (3,0) -> (1,3)
    expect(px(r, 2 - 1 - 1, 0)).toEqual(px(a, 0, 1)) // (0,1) -> (0,0)
  })
  test('turns compose: 1+3 and 2+2 are the identity, 2 keeps the size', () => {
    expect(rotate(rotate(a, 1), 3).data).toEqual(a.data)
    expect(rotate(rotate(a, 2), 2).data).toEqual(a.data)
    expect(rotate(a, 4).data).toEqual(a.data)
    expect(rotate(a, 2).width).toBe(4)
    expect(rotate(a, -1).data).toEqual(rotate(a, 3).data)
  })
  test('four single turns equal no turn', () => {
    let r = a
    for (let i = 0; i < 4; i++) r = rotate(r, 1)
    expect(r.data).toEqual(a.data)
  })
  test('flip moves pixels across the right axis and is its own inverse', () => {
    expect(px(flip(a, 'horizontal'), 0, 0)).toEqual(px(a, 3, 0))
    expect(px(flip(a, 'vertical'), 0, 0)).toEqual(px(a, 0, 1))
    expect(flip(flip(a, 'horizontal'), 'horizontal').data).toEqual(a.data)
    expect(flip(flip(a, 'vertical'), 'vertical').data).toEqual(a.data)
  })
})

describe('flattenOnWhite', () => {
  test('transparent becomes white, opaque is unchanged, half alpha blends', () => {
    const f = flattenOnWhite(make(3, 1, (x) => [[0, 0, 0, 0], [10, 20, 30, 255], [0, 0, 0, 128]][x]))
    expect(px(f, 0, 0)).toEqual([255, 255, 255, 255])
    expect(px(f, 1, 0)).toEqual([10, 20, 30, 255])
    const [r, , , a] = px(f, 2, 0)
    expect(a).toBe(255)
    expect(r).toBeGreaterThan(120)
    expect(r).toBeLessThan(135)
  })
})

describe('stitch', () => {
  const red = [255, 0, 0, 255]
  const blue = [0, 0, 255, 255]
  const base = { columns: 2, gap: 0, background: 'white' } as const

  test('horizontal scales to the smallest height and adds the gap', () => {
    const out = stitch([solid(10, 10, red), solid(40, 20, blue)], { ...base, direction: 'horizontal', gap: 4 })
    expect([out.width, out.height]).toEqual([10 + 4 + 20, 10]) // second image 40x20 -> 20x10
    expect(px(out, 0, 0)).toEqual(red)
    expect(px(out, 11, 5)).toEqual([255, 255, 255, 255]) // inside the gap
    expect(px(out, 15, 5)).toEqual(blue)
  })

  test('vertical scales to the smallest width', () => {
    const out = stitch([solid(20, 10, red), solid(10, 30, blue)], { ...base, direction: 'vertical' })
    expect([out.width, out.height]).toEqual([10, 5 + 30])
    expect(px(out, 0, 0)).toEqual(red)
    expect(px(out, 0, 34)).toEqual(blue)
  })

  test('grid: equal cells, rows from the column count, odd one out leaves background', () => {
    const imgs = [solid(10, 10, red), solid(10, 10, blue), solid(10, 10, red)]
    const out = stitch(imgs, { ...base, direction: 'grid', gap: 2 })
    expect([out.width, out.height]).toEqual([22, 22])
    expect(px(out, 12, 12)).toEqual([255, 255, 255, 255]) // empty fourth cell
    expect(px(out, 0, 12)).toEqual(red)
  })

  test('transparent background stays transparent where nothing is drawn', () => {
    const out = stitch([solid(4, 4, red), solid(4, 4, blue), solid(4, 4, red)], { ...base, direction: 'grid', background: 'transparent' })
    expect(px(out, 6, 6)[3]).toBe(0)
  })

  test('transparent images composite over the background', () => {
    const out = stitch([solid(2, 2, [0, 0, 0, 0])], { ...base, direction: 'horizontal' })
    expect(px(out, 0, 0)).toEqual([255, 255, 255, 255])
  })

  test('refuses nothing to stitch', () => {
    expect(() => stitch([], { ...base, direction: 'horizontal' })).toThrow(UserError)
  })

  test('the pixel limit is checked from the sizes alone, before anything is allocated', () => {
    // empty pixel data: if stitch tried to scale or draw this it would fail differently
    const huge: ImageBuffer = { width: 20000, height: 20000, data: new Uint8ClampedArray(0) }
    for (const direction of ['horizontal', 'vertical', 'grid'] as const) {
      expect(() => stitch([huge], { ...base, direction })).toThrow(/megapixels/)
    }
  })
})
