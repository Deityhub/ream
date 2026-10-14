import { describe, expect, test } from 'vitest'
import { NO_ADJUSTMENTS, adjust, blur, createImage, fill, overlay, pixelate, sharpen, type ImageBuffer } from '../src/index.ts'

const make = (w: number, h: number, fn: (x: number, y: number) => number[]): ImageBuffer => {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set(fn(x, y), (y * w + x) * 4)
  return img
}
const px = (img: ImageBuffer, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4))
const half = (x: number) => (x < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]) // black left, white right

describe('overlay', () => {
  test('opacity mixes, transparency leaves the base, and the layer is clipped at the edges', () => {
    const base = make(4, 4, () => [100, 100, 100, 255])
    overlay(base, make(2, 2, () => [200, 0, 0, 255]), 3, 3, 0.5)
    expect(px(base, 3, 3)).toEqual([150, 50, 50, 255])
    expect(px(base, 2, 2)).toEqual([100, 100, 100, 255])
    overlay(base, make(1, 1, () => [0, 255, 0, 0]), 0, 0)
    expect(px(base, 0, 0)).toEqual([100, 100, 100, 255])
    overlay(base, make(2, 2, () => [0, 0, 0, 255]), -1, -1) // only the bottom-right pixel lands
    expect(px(base, 0, 0)).toEqual([0, 0, 0, 255])
    expect(px(base, 1, 0)).toEqual([100, 100, 100, 255])
  })

  test('over a see-through base the colour is kept and the alpha adds up', () => {
    const base = make(1, 1, () => [0, 0, 0, 0])
    overlay(base, make(1, 1, () => [10, 20, 30, 128]), 0, 0)
    expect(px(base, 0, 0)).toEqual([10, 20, 30, 128])
  })
})

describe('blur', () => {
  test('softens an edge inside the area only, and keeps a flat colour flat', () => {
    const img = make(10, 4, half)
    blur(img, 2, { x: 0, y: 0, w: 10, h: 2 })
    expect(px(img, 4, 0)[0]).toBeGreaterThan(0)
    expect(px(img, 5, 0)[0]).toBeLessThan(255)
    expect(px(img, 4, 3)).toEqual([0, 0, 0, 255]) // outside the area
    const flat = make(6, 6, () => [40, 90, 200, 255])
    blur(flat, 3)
    expect(px(flat, 2, 2)).toEqual([40, 90, 200, 255])
  })

  test('see-through pixels do not darken the colour next to them', () => {
    const img = make(4, 1, (x) => (x < 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]))
    blur(img, 1)
    expect(px(img, 1, 0)[0]).toBeGreaterThan(250) // still pure red, only fainter
    expect(px(img, 1, 0)[3]).toBeLessThan(255)
  })
})

describe('pixelate and fill', () => {
  test('blocks take their average and the pixels beyond the area stay', () => {
    const img = make(4, 2, (x) => (x % 2 ? [200, 200, 200, 255] : [0, 0, 0, 255]))
    pixelate(img, 2, { x: 0, y: 0, w: 2, h: 2 })
    expect(px(img, 0, 0)).toEqual([100, 100, 100, 255])
    expect(px(img, 1, 1)).toEqual([100, 100, 100, 255])
    expect(px(img, 3, 0)).toEqual([200, 200, 200, 255])
  })

  test('fill leaves nothing of what was there', () => {
    const img = make(3, 3, (x, y) => [x * 50, y * 50, 9, 255])
    fill(img, [1, 2, 3], { x: 1, y: 1, w: 5, h: 5 }) // runs past the edge
    expect(px(img, 2, 2)).toEqual([1, 2, 3, 255])
    expect(px(img, 0, 0)).toEqual([0, 0, 9, 255])
    fill(img, [0, 0, 0], { x: 10, y: 10, w: 2, h: 2 }) // wholly outside: no change, no error
  })
})

describe('adjust and sharpen', () => {
  const grey = () => make(3, 3, () => [100, 100, 100, 200])
  test('no adjustments change nothing; alpha is never touched', () => {
    const img = grey()
    adjust(img, NO_ADJUSTMENTS)
    adjust(img, { ...NO_ADJUSTMENTS, brightness: 50, contrast: 20 })
    expect(px(img, 1, 1)[3]).toBe(200)
    const same = grey()
    adjust(same, NO_ADJUSTMENTS)
    expect(Array.from(same.data)).toEqual(Array.from(grey().data))
  })

  test('brightness, saturation, warmth and vignette move colours the expected way', () => {
    const a = make(1, 1, () => [100, 100, 100, 255])
    adjust(a, { ...NO_ADJUSTMENTS, brightness: 50 })
    expect(px(a, 0, 0)[0]).toBe(150)
    const c = make(1, 1, () => [200, 100, 50, 255])
    adjust(c, { ...NO_ADJUSTMENTS, saturation: -100 })
    const [r, g, b] = px(c, 0, 0)
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1)
    const w = make(1, 1, () => [100, 100, 100, 255])
    adjust(w, { ...NO_ADJUSTMENTS, warmth: 100 })
    expect(px(w, 0, 0)[0]).toBeGreaterThan(px(w, 0, 0)[2])
    const v = make(9, 9, () => [200, 200, 200, 255])
    adjust(v, { ...NO_ADJUSTMENTS, vignette: 100 })
    expect(px(v, 4, 4)[0]).toBe(200)
    expect(px(v, 0, 0)[0]).toBeLessThan(80)
  })

  test('sharpen steepens an edge and leaves flat areas alone', () => {
    const img = make(30, 3, (x) => (x < 15 ? [100, 100, 100, 255] : [160, 160, 160, 255]))
    sharpen(img, 1, 2)
    expect(px(img, 14, 1)[0]).toBeLessThan(100)
    expect(px(img, 15, 1)[0]).toBeGreaterThan(160)
    expect(px(img, 0, 1)[0]).toBe(100)
  })
})
