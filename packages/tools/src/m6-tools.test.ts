import { beforeAll, describe, expect, test } from 'vitest'
import type { FileData } from '@ream/core'
import { createImage, decodePng, encodePng, ownCodec, setCodec, type ImageBuffer } from '@ream/image-core'
import { run as watermark, type WatermarkImageOptions } from './watermark-image/run.ts'
import { defaultOptions as wmDefaults } from './watermark-image/Panel.tsx'
import { markSize, placements, type PlaceOptions } from './watermark-image/place.ts'
import { run as blurRun } from './blur-image/run.ts'
import { defaultOptions as blurDefaults, toArea } from './blur-image/apply.ts'
import { run as filters } from './filters-image/run.ts'
import { NONE, PRESETS, isUnchanged, presetOf, presetValues } from './filters-image/presets.ts'
import { run as memeRun, type MemeOptions } from './meme/run.ts'

beforeAll(() => setCodec(ownCodec))

const ctx = { progress: () => {} }
const make = (w: number, h: number, fn: (x: number, y: number) => number[]): ImageBuffer => {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set(fn(x, y), (y * w + x) * 4)
  return img
}
const file = async (img: ImageBuffer, name = 'pic.png'): Promise<FileData> => ({ name, type: 'image/png', bytes: await encodePng(img) })
const px = (img: ImageBuffer, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4))
const out = async (f: FileData) => decodePng(f.bytes)
const black = (w: number, h: number) => make(w, h, () => [0, 0, 0, 255])

describe('watermark-image', () => {
  const po = (o: Partial<PlaceOptions> = {}): PlaceOptions => ({ size: 50, layout: 'single', spot: 'mc', margin: 0, spacing: 0, ...o })

  test('size follows the picture width, and a single mark never outgrows the picture', () => {
    expect(markSize({ width: 200, height: 100 }, { width: 40, height: 10 }, po())).toEqual({ w: 100, h: 25 })
    expect(markSize({ width: 200, height: 20 }, { width: 10, height: 10 }, po({ size: 100 }))).toEqual({ w: 20, h: 20 })
    expect(markSize({ width: 200, height: 20 }, { width: 10, height: 10 }, po({ size: 100, layout: 'tile' }))).toEqual({ w: 200, h: 200 })
  })

  test('spots and margins; repeated marks cover the picture, offset row by row', () => {
    const img = { width: 100, height: 60 }
    expect(placements(img, 20, 10, po({ spot: 'tl', margin: 5 }))).toEqual([{ x: 5, y: 5 }])
    expect(placements(img, 20, 10, po({ spot: 'br', margin: 5 }))).toEqual([{ x: 75, y: 45 }])
    expect(placements(img, 20, 10, po())).toEqual([{ x: 40, y: 25 }])
    const tiles = placements(img, 20, 10, po({ layout: 'tile', spacing: 100 }))
    expect(tiles.length).toBeGreaterThan(6)
    const rowA = tiles.filter((t) => t.y === 25).map((t) => t.x)
    const rowB = tiles.filter((t) => t.y === 25 + 20).map((t) => t.x)
    expect(rowA).toContain(40)
    expect(rowB).toContain(60) // half a step (20) to the side
  })

  const mark = async () => encodePng(make(4, 2, () => [255, 255, 255, 255]))
  const wo = async (o: Partial<WatermarkImageOptions>): Promise<WatermarkImageOptions> => ({ ...wmDefaults, mark: await mark(), opacity: 100, spot: 'tl', margin: 0, ...o })

  test('stamps the mark where asked, leaves the rest, and keeps the format', async () => {
    const [f] = await watermark([await file(black(20, 10))], await wo({ size: 50 }), ctx)
    expect(f.name).toBe('pic-watermarked.png')
    const img = await out(f)
    expect(px(img, 0, 0)).toEqual([255, 255, 255, 255])
    expect(px(img, 9, 4)).toEqual([255, 255, 255, 255]) // the mark is 10 x 5
    expect(px(img, 10, 0)).toEqual([0, 0, 0, 255])
    expect(px(img, 0, 5)).toEqual([0, 0, 0, 255])
  })

  test('opacity, repeating, and each picture sized to itself', async () => {
    const [half] = await watermark([await file(black(20, 10))], await wo({ opacity: 50 }), ctx)
    expect(px(await out(half), 0, 0)[0]).toBe(128)
    const [tiled] = await watermark([await file(black(40, 20))], await wo({ layout: 'tile', size: 25, spacing: 100 }), ctx)
    const t = await out(tiled)
    const lit = Array.from({ length: 40 * 20 }, (_, i) => t.data[i * 4]).filter((v) => v > 0).length
    expect(lit).toBeGreaterThan(40) // many marks, not one
    const both = await watermark([await file(black(20, 10), 'a.png'), await file(black(100, 50), 'b.png')], await wo({ size: 50 }), ctx)
    expect(px(await out(both[0]), 9, 4)[0]).toBe(255)
    expect(px(await out(both[1]), 49, 24)[0]).toBe(255) // 50 wide, 25 tall
    expect(px(await out(both[1]), 50, 0)[0]).toBe(0)
  })

  test('asks for text or a logo first', async () => {
    await expect(watermark([await file(black(4, 4))], { ...wmDefaults, mark: null }, ctx)).rejects.toThrow('Type the text')
    await expect(watermark([await file(black(4, 4))], { ...wmDefaults, source: 'logo', mark: null }, ctx)).rejects.toThrow('Choose a logo')
  })
})

describe('blur-image', () => {
  const stripes = () => make(20, 20, (x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
  const area = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } // pixels 5..15

  test('fractions become whole pixels inside the picture', () => {
    expect(toArea(area, 20, 20)).toEqual({ x: 5, y: 5, w: 10, h: 10 })
    expect(toArea({ x: 0.999, y: 0, w: 0.001, h: 1 }, 20, 20).w).toBe(1)
  })

  test('each way changes the chosen part and nothing else', async () => {
    const src = await file(stripes())
    for (const mode of ['blur', 'pixelate', 'box'] as const) {
      const [f] = await blurRun([src], { ...blurDefaults, mode, areas: [area] }, ctx)
      const img = await out(f)
      expect(f.name).toBe(mode === 'box' ? 'pic-covered.png' : 'pic-blurred.png')
      expect(px(img, 2, 10)).toEqual(px(stripes(), 2, 10)) // outside
      expect(px(img, 11, 10)).not.toEqual(px(stripes(), 11, 10)) // inside (a white stripe; the box is black)
    }
    const [box] = await blurRun([src], { ...blurDefaults, mode: 'box', colour: '#ff0000', areas: [area] }, ctx)
    expect(px(await out(box), 10, 10)).toEqual([255, 0, 0, 255])
    expect(px(await out(box), 4, 4)).toEqual(px(stripes(), 4, 4))
  })

  test('several parts are all treated', async () => {
    const [f] = await blurRun([await file(stripes())], { ...blurDefaults, mode: 'box', areas: [{ x: 0, y: 0, w: 0.25, h: 0.25 }, { x: 0.75, y: 0.75, w: 0.25, h: 0.25 }] }, ctx)
    const img = await out(f)
    expect(px(img, 1, 1)).toEqual([0, 0, 0, 255])
    expect(px(img, 18, 18)).toEqual([0, 0, 0, 255])
    expect(px(img, 19, 18)).toEqual([0, 0, 0, 255]) // was white
  })

  test('asks for a part first', async () => {
    await expect(blurRun([await file(stripes())], blurDefaults, ctx)).rejects.toThrow('Drag on the picture')
  })
})

describe('filters-image', () => {
  test('looks match their values, and unchanged means unchanged', () => {
    expect(isUnchanged(NONE)).toBe(true)
    for (const p of PRESETS) expect(presetOf(presetValues(p.id))).toBe(p.id)
    expect(presetOf({ ...presetValues('vivid'), blur: 3 })).toBeUndefined()
  })

  test('black and white removes colour; blur and sharpen run on the whole picture', async () => {
    const src = await file(make(8, 8, (x) => (x < 4 ? [200, 40, 40, 255] : [30, 90, 220, 255])))
    const [bw] = await filters([src], presetValues('mono'), ctx)
    expect(bw.name).toBe('pic-filtered.png')
    const [r, g, b] = px(await out(bw), 1, 1)
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1)
    const soft = await out((await filters([src], { ...NONE, blur: 60 }, ctx))[0])
    expect(px(soft, 3, 4)[0]).toBeLessThan(200) // the edge has spread
    const crisp = await out((await filters([src], { ...NONE, sharpen: 100 }, ctx))[0])
    expect(px(crisp, 3, 4)).not.toEqual(px(await out(src), 3, 4))
  })

  test('needs something to apply', async () => {
    await expect(filters([await file(black(4, 4))], NONE, ctx)).rejects.toThrow('Choose a look')
  })
})

describe('meme', () => {
  const mo = async (o: Partial<MemeOptions>): Promise<MemeOptions> => ({ top: '', bottom: '', size: 10, colour: '#ffffff', topPng: null, bottomPng: null, ...o })
  const band = (w: number, h: number, c: number[]) => encodePng(make(w, h, () => c))

  test('captions sit at the top and bottom edges, with a small gap', async () => {
    const [f] = await memeRun([await file(black(100, 100))], await mo({ topPng: await band(100, 10, [255, 0, 0, 255]), bottomPng: await band(100, 10, [0, 255, 0, 255]) }), ctx)
    expect(f.name).toBe('pic-meme.png')
    const img = await out(f)
    expect(px(img, 50, 1)).toEqual([0, 0, 0, 255]) // the gap (2 px)
    expect(px(img, 50, 2)).toEqual([255, 0, 0, 255])
    expect(px(img, 50, 11)).toEqual([255, 0, 0, 255])
    expect(px(img, 50, 12)).toEqual([0, 0, 0, 255])
    expect(px(img, 50, 88)).toEqual([0, 255, 0, 255])
    expect(px(img, 50, 97)).toEqual([0, 255, 0, 255])
    expect(px(img, 50, 98)).toEqual([0, 0, 0, 255])
  })

  test('a caption made for another width is scaled to the picture', async () => {
    const [f] = await memeRun([await file(black(100, 100))], await mo({ topPng: await band(50, 5, [255, 0, 0, 255]) }), ctx)
    const img = await out(f)
    expect(px(img, 99, 5)).toEqual([255, 0, 0, 255])
    expect(px(img, 50, 13)).toEqual([0, 0, 0, 255])
  })

  test('needs a caption', async () => {
    await expect(memeRun([await file(black(10, 10))], await mo({}), ctx)).rejects.toThrow('Type a caption')
  })
})
