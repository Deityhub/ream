import { beforeAll, describe, expect, test } from 'vitest'
import { UserError, type FileData } from '@ream/core'
import { buildExif, createImage, decodeGif, decodeJpeg, decodePng, encodeGif, encodeJpeg, encodePng, ownCodec, readImageMetadata, readSegments, setCodec, type ExifEntry, type ImageBuffer } from '@ream/image-core'
import { run as compress } from './compress-image/run.ts'
import { defaultOptions as compressDefaults } from './compress-image/options.ts'
import { run as makeGif } from './animated-gif/run.ts'
import { defaultOptions as gifDefaults } from './animated-gif/options.ts'
import { run as clean } from './image-metadata/run.ts'
import { run as convert } from './convert-image/run.ts'

beforeAll(() => setCodec(ownCodec))

const ctx = { progress: () => {} }
const make = (w: number, h: number, px: (x: number, y: number) => number[]): ImageBuffer => {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.data.set(px(x, y), (y * w + x) * 4)
  return img
}
const photo = (w = 96, h = 64) => make(w, h, (x, y) => [(x * 255) / w, (y * 255) / h, 128 + 100 * Math.sin((x + y) / 7), 255])
const file = (name: string, type: string, bytes: Uint8Array): FileData => ({ name, type, bytes })
const psnr = (a: ImageBuffer, b: ImageBuffer) => {
  let s = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) for (let c = 0; c < 3; c++, n++) s += (a.data[i + c] - b.data[i + c]) ** 2
  return s === 0 ? Infinity : 10 * Math.log10(255 ** 2 / (s / n))
}
const distinct = (img: ImageBuffer) => new Set(Array.from({ length: img.width * img.height }, (_, i) => Array.from(img.data.subarray(i * 4, i * 4 + 4)).join(','))).size

// an EXIF block with camera details, a position, a maker note and an orientation, as a complete APP1 segment
const e = (ifd: ExifEntry['ifd'], tag: number, type: number, count: number, data: number[]): ExifEntry => ({ ifd, tag, type, count, data: Uint8Array.from(data) })
const ascii = (s: string) => [...Array.from(s, (c) => c.charCodeAt(0)), 0]
const rational = (...pairs: [number, number][]) => pairs.flatMap(([n, d]) => [n >> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255, d >> 24, (d >> 16) & 255, (d >> 8) & 255, d & 255])
function exifSegment(orientation: number): Uint8Array {
  const tiff = buildExif(
    [
      e('ifd0', 0x010f, 2, 6, ascii('Canon')),
      e('ifd0', 0x0110, 2, 8, ascii('EOS R5')),
      e('ifd0', 0x0112, 3, 1, [0, orientation]),
      e('exif', 0x9003, 2, 20, ascii('2024:05:06 07:08:09')),
      e('exif', 0x927c, 7, 8, [1, 2, 3, 4, 5, 6, 7, 8]),
      e('gps', 1, 2, 2, ascii('N')),
      e('gps', 2, 5, 3, rational([51, 1], [30, 1], [26, 1])),
      e('gps', 3, 2, 2, ascii('W')),
      e('gps', 4, 5, 3, rational([0, 1], [7, 1], [39, 1])),
    ],
    false,
  )
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  return Uint8Array.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body])
}
const icc = (): Uint8Array => {
  const body = [...ascii('ICC_PROFILE'), 1, 1, ...new Array<number>(40).fill(7)]
  return Uint8Array.from([0xff, 0xe2, (body.length + 2) >> 8, (body.length + 2) & 255, ...body])
}
const tagged = (img: ImageBuffer, orientation = 1) => encodeJpeg(img, { quality: 95, subsampling: '444', segments: [exifSegment(orientation), icc()] })

describe('compress-image', () => {
  test('a JPEG gets smaller, close to the original, and loses its camera data', async () => {
    const img = photo(160, 120)
    const input = file('IMG.jpg', 'image/jpeg', tagged(img))
    const [out] = await compress([input], { ...compressDefaults, quality: 60 }, ctx)
    expect(out.name).toBe('IMG-compressed.jpg')
    expect(out.bytes.length).toBeLessThan(input.bytes.length * 0.7)
    expect(psnr(img, decodeJpeg(out.bytes))).toBeGreaterThan(30)
    const kinds = readSegments(out.bytes).segments.map((s) => s.kind)
    expect(kinds).toContain('icc') // the profile always stays
    expect(kinds).not.toContain('exif')
  })

  test('keeping metadata keeps the EXIF, with the orientation reset because the pixels are turned upright', async () => {
    const img = photo(64, 40)
    const input = file('IMG.jpg', 'image/jpeg', tagged(img, 6))
    const [out] = await compress([input], { ...compressDefaults, keepMetadata: true, quality: 70 }, ctx)
    const meta = readImageMetadata(out.bytes)!
    expect(meta.groups.find((g) => g.title === 'Camera')?.fields.map((f) => f.value)).toEqual(['Canon', 'EOS R5'])
    expect(meta.orientation).toBe(1)
    const pixels = decodeJpeg(out.bytes)
    expect([pixels.width, pixels.height]).toEqual([40, 64]) // the sideways photo was turned
  })

  test('a lower quality is smaller', async () => {
    const input = file('a.jpg', 'image/jpeg', tagged(photo(160, 120)))
    const sizes = await Promise.all([30, 60, 90].map(async (quality) => (await compress([input], { ...compressDefaults, quality }, ctx))[0].bytes.length))
    expect(sizes[0]).toBeLessThan(sizes[1])
    expect(sizes[1]).toBeLessThan(sizes[2])
  })

  test('a file that cannot get smaller comes back unchanged instead of growing', async () => {
    const small = file('tiny.jpg', 'image/jpeg', encodeJpeg(photo(16, 16), { quality: 20 }))
    const [out] = await compress([small], { ...compressDefaults, quality: 95 }, ctx)
    expect(Array.from(out.bytes)).toEqual(Array.from(small.bytes))
    expect(out.name).toBe('tiny-compressed.jpg')
  })

  test('PNG stays pixel for pixel, and fewer colours makes it much smaller', async () => {
    // a gradient with a little noise, which a true-colour PNG stores expensively
    let seed = 3
    const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 25) - 12
    const img = make(120, 80, (x, y) => [x * 2 + noise(), y * 3 + noise(), x + y + noise(), 255])
    const input = file('shot.png', 'image/png', await encodePng(img, { optimize: false }))
    const [same] = await compress([input], compressDefaults, ctx)
    expect(Array.from((await decodePng(same.bytes)).data)).toEqual(Array.from(img.data))
    const [fewer] = await compress([input], { ...compressDefaults, reduceColors: true, colors: 32, dither: false }, ctx)
    expect(distinct(await decodePng(fewer.bytes))).toBeLessThanOrEqual(32)
    expect(fewer.bytes.length).toBeLessThan(input.bytes.length * 0.5)
  })

  test('PNG colour information is carried over', async () => {
    const img = make(8, 8, () => [10, 20, 30, 255])
    const plain = await encodePng(img)
    // a gAMA chunk, inserted after the header
    const gama = Uint8Array.from([0, 0, 0, 4, 0x67, 0x41, 0x4d, 0x41, 0, 1, 0x86, 0xa0, 0x31, 0xe8, 0x96, 0x5f])
    const withGama = Uint8Array.from([...plain.subarray(0, 33), ...gama, ...plain.subarray(33)])
    const [out] = await compress([file('g.png', 'image/png', withGama)], { ...compressDefaults, reduceColors: true }, ctx)
    expect(String.fromCharCode(...out.bytes.subarray(37, 41))).toBe('gAMA')
  })

  test('an animated GIF keeps every frame and its timing', async () => {
    const frames = [0, 1, 2].map((t) => ({ image: make(40, 30, (x, y) => [(x * 6) & 255, (y * 8) & 255, t * 90, 255]), delay: 80 + t * 20 }))
    const input = file('a.gif', 'image/gif', encodeGif(frames, { loops: 3 }))
    const [out] = await compress([input], { ...compressDefaults, reduceColors: true, colors: 16 }, ctx)
    const gif = decodeGif(out.bytes)
    expect(gif.frames.map((f) => f.delay)).toEqual([80, 100, 120])
    expect(gif.loops).toBe(3)
    expect(out.name).toBe('a-compressed.gif')
    expect(out.type).toBe('image/gif')
    for (const f of gif.frames) expect(distinct(f.image)).toBeLessThanOrEqual(16)
  })

  test('a BMP becomes a PNG', async () => {
    const bmp = await ownCodec.encode(photo(20, 20), 'image/bmp')
    const [out] = await compress([file('old.bmp', 'image/bmp', bmp)], compressDefaults, ctx)
    expect(out.name).toBe('old-compressed.png')
    expect(out.type).toBe('image/png')
    expect(out.bytes.length).toBeLessThan(bmp.length)
  })

  test('a bad quality or an unreadable file is a readable error', async () => {
    await expect(compress([file('a.jpg', 'image/jpeg', encodeJpeg(photo(8, 8)))], { ...compressDefaults, quality: 0 }, ctx)).rejects.toThrow('Quality')
    await expect(compress([file('bad.jpg', 'image/jpeg', Uint8Array.from([1, 2, 3]))], compressDefaults, ctx)).rejects.toThrow("bad.jpg: This isn't a JPEG file.")
  })
})

describe('animated-gif', () => {
  async function pngs(specs: [number, number, number[]][]): Promise<FileData[]> {
    return Promise.all(specs.map(async ([w, h, c], i) => file(`p${i}.png`, 'image/png', await encodePng(make(w, h, () => c)))))
  }

  test('makes a looping GIF with the pictures in order, at the delay asked for', async () => {
    const files = await pngs([[60, 40, [255, 0, 0, 255]], [60, 40, [0, 255, 0, 255]], [60, 40, [0, 0, 255, 255]]])
    const [out] = await makeGif(files, { ...gifDefaults, delay: 300 }, ctx)
    expect(out.name).toBe('animation.gif')
    expect(out.type).toBe('image/gif')
    const gif = decodeGif(out.bytes)
    expect([gif.width, gif.height, gif.frames.length, gif.loops]).toEqual([60, 40, 3, 0])
    expect(gif.frames.map((f) => f.delay)).toEqual([300, 300, 300])
    expect(gif.frames.map((f) => Array.from(f.image.data.subarray(0, 3)))).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]])
  })

  test('play once writes no loop block; back and forth shows the middle pictures twice but not the ends', async () => {
    const files = await pngs([[8, 8, [255, 0, 0, 255]], [8, 8, [0, 255, 0, 255]], [8, 8, [0, 0, 255, 255]]])
    const once = decodeGif((await makeGif(files, { ...gifDefaults, loop: 'once' }, ctx))[0].bytes)
    expect(once.loops).toBe(1) // no loop block: the decoder's default
    const swing = decodeGif((await makeGif(files, { ...gifDefaults, pingPong: true }, ctx))[0].bytes)
    // red, green, blue, green: the green channel
    expect(swing.frames.map((f) => f.image.data[1])).toEqual([0, 255, 0, 255])
  })

  test('pictures of other shapes are fitted into the first one\'s frame', async () => {
    const files = await pngs([[60, 40, [255, 0, 0, 255]], [20, 40, [0, 255, 0, 255]]])
    const contain = decodeGif((await makeGif(files, { ...gifDefaults, fit: 'contain', background: 'white' }, ctx))[0].bytes)
    // the narrow green picture sits in the middle with white bars either side
    const row = (i: number) => Array.from({ length: 60 }, (_, x) => Array.from(contain.frames[i].image.data.subarray((20 * 60 + x) * 4, (20 * 60 + x) * 4 + 3)))
    expect(row(1)[0]).toEqual([255, 255, 255])
    expect(row(1)[30]).toEqual([0, 255, 0])
    expect(row(1)[59]).toEqual([255, 255, 255])
    const cover = decodeGif((await makeGif(files, { ...gifDefaults, fit: 'cover' }, ctx))[0].bytes)
    expect(Array.from(cover.frames[1].image.data.subarray(0, 3))).toEqual([0, 255, 0])
    expect(Array.from(cover.frames[1].image.data.subarray(59 * 4, 59 * 4 + 3))).toEqual([0, 255, 0])
  })

  test('a width resizes the whole animation, keeping the first picture\'s shape', async () => {
    const files = await pngs([[200, 100, [1, 2, 3, 255]], [200, 100, [4, 5, 6, 255]]])
    const gif = decodeGif((await makeGif(files, { ...gifDefaults, width: 100 }, ctx))[0].bytes)
    expect([gif.width, gif.height]).toEqual([100, 50])
  })

  test('a transparent background shows through in the bars', async () => {
    const files = await pngs([[60, 40, [255, 0, 0, 255]], [20, 40, [0, 255, 0, 255]]])
    const gif = decodeGif((await makeGif(files, { ...gifDefaults, background: 'transparent' }, ctx))[0].bytes)
    expect(gif.frames[1].image.data[3]).toBe(0)
    expect(gif.frames[1].image.data[(20 * 60 + 30) * 4 + 3]).toBe(255)
  })

  test('mistakes are explained', async () => {
    const files = await pngs([[8, 8, [1, 1, 1, 255]], [8, 8, [2, 2, 2, 255]]])
    await expect(makeGif(files.slice(0, 1), gifDefaults, ctx)).rejects.toThrow('at least two')
    await expect(makeGif(files, { ...gifDefaults, delay: 5 }, ctx)).rejects.toThrow('20 milliseconds')
  })
})

describe('image-metadata', () => {
  const input = () => file('IMG_1.jpg', 'image/jpeg', tagged(photo(48, 32), 6))

  test('remove everything keeps the profile and the orientation, and not one pixel changes', async () => {
    const f = input()
    const [out] = await clean([f], { mode: 'all' }, ctx)
    expect(out.name).toBe('IMG_1-clean.jpg')
    const meta = readImageMetadata(out.bytes)!
    expect(meta.location).toBe(false)
    expect(meta.groups.map((g) => g.title)).toEqual(['Picture']) // only the orientation
    expect(meta.orientation).toBe(6)
    expect(readSegments(out.bytes).segments.some((s) => s.kind === 'icc')).toBe(true)
    expect(Array.from(decodeJpeg(out.bytes).data)).toEqual(Array.from(decodeJpeg(f.bytes).data))
    expect(out.bytes.length).toBeLessThan(f.bytes.length)
  })

  test('an upright photo ends up with no EXIF at all', async () => {
    const [out] = await clean([file('up.jpg', 'image/jpeg', tagged(photo(16, 16), 1))], { mode: 'all' }, ctx)
    expect(readSegments(out.bytes).segments.some((s) => s.kind === 'exif')).toBe(false)
  })

  test('remove location only leaves camera and date', async () => {
    const before = readImageMetadata(input().bytes)!
    expect(before.location).toBe(true)
    expect(before.groups.find((g) => g.title === 'Location')?.fields[0].value).toBe('51.50722° N, 0.1275° W')
    const [out] = await clean([input()], { mode: 'location' }, ctx)
    const meta = readImageMetadata(out.bytes)!
    expect(meta.location).toBe(false)
    expect(meta.groups.map((g) => g.title)).toEqual(['Camera', 'Date', 'Picture'])
    expect(meta.extras).not.toContain('Camera maker notes')
  })

  test('data after the picture (motion photos) goes with "remove everything" but not "location only"', async () => {
    const base = tagged(photo(16, 16), 1)
    const withTrailer = Uint8Array.from([...base, ...new Array<number>(500).fill(0x66)])
    expect(readImageMetadata(withTrailer)!.extras.join()).toContain('Extra data')
    const [all] = await clean([file('m.jpg', 'image/jpeg', withTrailer)], { mode: 'all' }, ctx)
    expect(all.bytes.length).toBeLessThan(base.length)
    expect(decodeJpeg(all.bytes).width).toBe(16)
    const [loc] = await clean([file('m.jpg', 'image/jpeg', withTrailer)], { mode: 'location' }, ctx)
    expect(loc.bytes.length).toBeGreaterThan(base.length - 50)
  })

  test('PNG text and time chunks are removed, the picture and its colour chunks stay', async () => {
    const plain = await encodePng(make(6, 6, (x) => [x * 40, 5, 9, 255]))
    const chunk = (type: string, data: number[]) => {
      const body = Uint8Array.from([...type].map((c) => c.charCodeAt(0)).concat(data))
      return Uint8Array.from([0, 0, 0, data.length, ...body, 0, 0, 0, 0]) // checksum is not checked by our reader
    }
    const text = chunk('tEXt', [...ascii('Author').slice(0, 6), 0, ...[...'Jane'].map((c) => c.charCodeAt(0))])
    const time = chunk('tIME', [7, 232, 5, 6, 7, 8, 9])
    const gama = chunk('gAMA', [0, 1, 134, 160])
    const png = Uint8Array.from([...plain.subarray(0, 33), ...gama, ...text, ...time, ...plain.subarray(33)])
    expect(readImageMetadata(png)!.groups.find((g) => g.title === 'Text')?.fields).toEqual([{ label: 'Author', value: 'Jane' }])
    const [out] = await clean([file('p.png', 'image/png', png)], { mode: 'all' }, ctx)
    const types = (b: Uint8Array) => {
      const t: string[] = []
      for (let at = 8; at < b.length; at += 12 + new DataView(b.buffer, b.byteOffset).getUint32(at)) t.push(String.fromCharCode(...b.subarray(at + 4, at + 8)))
      return t
    }
    expect(types(out.bytes)).toEqual(types(png).filter((t) => t !== 'tEXt' && t !== 'tIME'))
    expect(types(out.bytes)).toContain('gAMA')
    expect(Array.from((await decodePng(out.bytes)).data)).toEqual(Array.from((await decodePng(plain)).data))
  })

  test('other formats are refused with a clear message', async () => {
    await expect(clean([file('a.gif', 'image/gif', Uint8Array.from([1]))], { mode: 'all' }, ctx)).rejects.toBeInstanceOf(UserError)
  })
})

describe('convert-image to the new formats', () => {
  test('GIF and BMP outputs read back', async () => {
    const src = file('a.png', 'image/png', await encodePng(photo(24, 16)))
    const [gif] = await convert([src], { format: 'image/gif', quality: 90 }, ctx)
    expect(gif.name).toBe('a.gif')
    expect(decodeGif(gif.bytes).width).toBe(24)
    const [bmp] = await convert([src], { format: 'image/bmp', quality: 90 }, ctx)
    expect(bmp.name).toBe('a.bmp')
    expect((await ownCodec.decode(bmp.bytes, 'image/bmp')).height).toBe(16)
  })
})
