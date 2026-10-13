import { beforeAll, describe, expect, test } from 'vitest'
import { UserError, type FileData } from '@ream/core'
import { createImage, decodePng, encodePng, ownCodec, setCodec } from '@ream/image-core'
import { run as resize, computeSize, type ResizeOptions } from './resize-image/run.ts'
import { run as convert } from './convert-image/run.ts'
import { run as rotate } from './rotate-image/run.ts'
import { run as crop } from './crop-image/run.ts'
import { cropBox } from './crop-image/box.ts'
import { run as mergeImages, type MergeImagesOptions } from './merge-images/run.ts'

beforeAll(() => setCodec(ownCodec)) // the browser codec needs a canvas; the real one is exercised in the app

const ctx = { progress: () => {} }
async function png(name: string, w: number, h: number, fn: (x: number, y: number) => number[]): Promise<FileData> {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set(fn(x, y), (y * w + x) * 4)
  return { name, type: 'image/png', bytes: await encodePng(img) }
}
const size = async (f: FileData) => {
  const img = await decodePng(f.bytes)
  return [img.width, img.height]
}
const ro = (o: Partial<ResizeOptions>): ResizeOptions => ({ mode: 'pixels', width: 0, height: 0, percent: 50, keepAspect: true, ...o })
const flat = (c: number[]) => () => c

describe('resize-image', () => {
  test('computeSize: one side keeps the aspect, both fit inside the box, percent scales both', () => {
    expect(computeSize(10, 20, ro({ width: 5 }))).toEqual([5, 10])
    expect(computeSize(10, 20, ro({ height: 40 }))).toEqual([20, 40])
    expect(computeSize(10, 20, ro({ width: 8, height: 8 }))).toEqual([4, 8])
    expect(computeSize(10, 20, ro({ mode: 'percent', percent: 50 }))).toEqual([5, 10])
    expect(computeSize(10, 20, ro({ mode: 'percent', percent: 1 }))).toEqual([1, 1]) // never below 1px
    expect(computeSize(10, 20, ro({ keepAspect: false, width: 7, height: 3 }))).toEqual([7, 3])
  })

  test('computeSize: missing input gives a clear message', () => {
    expect(() => computeSize(10, 20, ro({}))).toThrow('Enter a width or a height.')
    expect(() => computeSize(10, 20, ro({ keepAspect: false, width: 5 }))).toThrow('Enter both a width and a height')
    expect(() => computeSize(10, 20, ro({ mode: 'percent', percent: 0 }))).toThrow('Enter a percentage above 0.')
  })

  test('resizes every file and names the outputs', async () => {
    const out = await resize([await png('a.png', 10, 20, flat([1, 2, 3, 255])), await png('b.png', 40, 10, flat([4, 5, 6, 255]))], ro({ width: 5 }), ctx)
    expect(out.map((f) => f.name)).toEqual(['a-resized.png', 'b-resized.png'])
    expect(await size(out[0])).toEqual([5, 10])
    expect(await size(out[1])).toEqual([5, 1])
  })

  test('an unreadable file is named in the error', async () => {
    const bad: FileData = { name: 'broken.png', type: 'image/png', bytes: new TextEncoder().encode('nope') }
    await expect(resize([bad], ro({ width: 5 }), ctx)).rejects.toThrow("broken.png: This isn't a PNG file.")
  })
})

describe('convert-image', () => {
  test('to PNG keeps pixels and renames', async () => {
    const f = await png('shot.png', 3, 2, (x) => [x * 50, 9, 9, 200])
    const [out] = await convert([f], { format: 'image/png', quality: 90 }, ctx)
    expect(out.name).toBe('shot.png')
    expect(await decodePng(out.bytes)).toEqual(await decodePng(f.bytes))
  })

  test('formats the codec cannot write are reported, not mangled', async () => {
    await expect(convert([await png('a.png', 2, 2, flat([0, 0, 0, 255]))], { format: 'image/jpeg', quality: 90 }, ctx)).rejects.toBeInstanceOf(UserError)
  })
})

describe('rotate-image', () => {
  test('a clockwise turn swaps the size; flips keep it', async () => {
    const f = await png('r.png', 4, 2, flat([0, 0, 0, 255]))
    expect(await size((await rotate([f], { turns: 1, flipH: false, flipV: false }, ctx))[0])).toEqual([2, 4])
    expect(await size((await rotate([f], { turns: 0, flipH: true, flipV: true }, ctx))[0])).toEqual([4, 2])
  })

  test('flip then turn moves the marker pixel where expected', async () => {
    // marker at (0,0) in a 4x2 image; flipH puts it at (3,0); one clockwise turn moves (3,0) to (h-1-0, 3) = (1,3)
    const f = await png('m.png', 4, 2, (x, y) => (x === 0 && y === 0 ? [255, 0, 0, 255] : [0, 0, 0, 255]))
    const img = await decodePng((await rotate([f], { turns: 1, flipH: true, flipV: false }, ctx))[0].bytes)
    const at = (1 + 3 * img.width) * 4
    expect(Array.from(img.data.subarray(at, at + 3))).toEqual([255, 0, 0])
  })

  test('nothing chosen is an error', async () => {
    await expect(rotate([await png('a.png', 2, 2, flat([0, 0, 0, 255]))], { turns: 0, flipH: false, flipV: false }, ctx)).rejects.toThrow('Choose a rotation')
  })
})

describe('crop-image', () => {
  test('fractions become pixels', async () => {
    const f = await png('c.png', 10, 4, (x) => [x * 20, 0, 0, 255])
    const [out] = await crop([f], { x: 0.5, y: 0, w: 0.5, h: 1 }, ctx)
    expect(out.name).toBe('c-cropped.png')
    const img = await decodePng(out.bytes)
    expect([img.width, img.height]).toEqual([5, 4])
    expect(img.data[0]).toBe(100) // first kept column is x = 5
  })

  test('the preview box matches what is cropped, even when the edges round differently', async () => {
    // x = 0.2495 and w = 0.4985 of 400px: the edges round to 100 and 299, so the box is 199 wide, not round(199.4) = 199 by luck
    for (const o of [{ x: 0.2495, y: 0, w: 0.4985, h: 1 }, { x: 0.2505, y: 0, w: 0.4995, h: 1 }, { x: 0.3333, y: 0.1, w: 0.3333, h: 0.5 }]) {
      const box = cropBox(o, 400, 300)
      const [out] = await crop([await png('c.png', 400, 300, flat([0, 0, 0, 255]))], o, ctx)
      expect(await size(out)).toEqual([box.w, box.h])
    }
  })

  test('an empty selection asks the user to choose one', async () => {
    await expect(crop([await png('c.png', 10, 4, flat([0, 0, 0, 255]))], { x: 0.5, y: 0.5, w: 0, h: 0 }, ctx)).rejects.toThrow('Drag on the image')
  })

  test('a selection running past the edge is clamped', async () => {
    const [out] = await crop([await png('c.png', 10, 4, flat([0, 0, 0, 255]))], { x: 0.8, y: 0, w: 0.5, h: 1 }, ctx)
    expect(await size(out)).toEqual([2, 4])
  })
})

describe('merge-images', () => {
  const opts: MergeImagesOptions = { direction: 'horizontal', columns: 2, gap: 2, background: 'white', format: 'image/png', quality: 90 }

  test('joins images into one file', async () => {
    const [out, ...rest] = await mergeImages([await png('a.png', 10, 10, flat([255, 0, 0, 255])), await png('b.png', 20, 10, flat([0, 0, 255, 255]))], opts, ctx)
    expect(rest).toHaveLength(0)
    expect(out.name).toBe('merged.png')
    expect(await size(out)).toEqual([10 + 2 + 20, 10])
  })

  test('needs two images', async () => {
    await expect(mergeImages([await png('a.png', 2, 2, flat([0, 0, 0, 255]))], opts, ctx)).rejects.toThrow('Add at least two images')
  })
})
