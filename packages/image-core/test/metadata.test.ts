import { describe, expect, test } from 'vitest'
import { buildExif, cleanImageMetadata, colourChunks, createImage, encodeJpeg, encodePng, parseExif, readChunks, readImageMetadata, readSegments, type ExifEntry } from '../src/index.ts'

const e = (ifd: ExifEntry['ifd'], tag: number, type: number, count: number, data: number[]): ExifEntry => ({ ifd, tag, type, count, data: Uint8Array.from(data) })
const ascii = (s: string) => [...Array.from(s, (c) => c.charCodeAt(0)), 0]
const u32 = (n: number, le: boolean) => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255] : [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255])
const rat = (le: boolean, ...pairs: [number, number][]) => pairs.flatMap(([n, d]) => [...u32(n, le), ...u32(d, le)])
const short = (v: number, le: boolean) => (le ? [v, 0] : [0, v])

/** camera, exposure, a position, a maker note and a sub-directory, in the given byte order */
const sample = (le: boolean): ExifEntry[] => [
  e('ifd0', 0x010f, 2, 6, ascii('Canon')),
  e('ifd0', 0x0112, 3, 1, short(6, le)),
  e('exif', 0x829a, 5, 1, rat(le, [1, 500])),
  e('exif', 0x9003, 2, 20, ascii('2023:12:31 23:59:58')),
  e('exif', 0x927c, 7, 6, [9, 8, 7, 6, 5, 4]),
  e('interop', 0x0001, 2, 4, ascii('R98')),
  e('gps', 1, 2, 2, ascii('S')),
  e('gps', 2, 5, 3, rat(le, [33, 1], [51, 1], [30, 1])),
  e('gps', 3, 2, 2, ascii('E')),
  e('gps', 4, 5, 3, rat(le, [151, 1], [12, 1], [0, 1])),
  e('gps', 6, 5, 1, rat(le, [125, 2])),
]
const sorted = (x: ExifEntry[]) => [...x].map((a) => `${a.ifd}:${a.tag}:${a.type}:${a.count}:${Array.from(a.data).join(',')}`).sort()

describe('EXIF writing and reading', () => {
  test.each([true, false])('what buildExif writes, parseExif reads back (little-endian %s)', (le) => {
    const x = parseExif(buildExif(sample(le), le))!
    expect(x.le).toBe(le)
    expect(sorted(x.entries)).toEqual(sorted(sample(le)))
  })

  test('directories are written with tags in ascending order and out-of-line values on even offsets', () => {
    const tiff = buildExif(sample(true), true)
    expect(tiff.length % 2).toBe(0)
    const u16 = (o: number) => tiff[o] | (tiff[o + 1] << 8)
    const tags = Array.from({ length: u16(8) }, (_, i) => u16(10 + i * 12))
    expect(tags).toEqual([...tags].sort((a, b) => a - b))
  })

  test('garbage and short blocks are not EXIF', () => {
    expect(parseExif(Uint8Array.from([1, 2, 3]))).toBeNull()
    expect(parseExif(Uint8Array.from([0x49, 0x49, 0x2b, 0, 8, 0, 0, 0]))).toBeNull() // not TIFF's magic 42
  })

  test('a corrupt directory cannot loop or run past the data', () => {
    // IFD0 at 8 pointing back at itself as the next IFD
    const looped = Uint8Array.from([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 0, 8, 0, 0, 0])
    expect(parseExif(looped)!.entries).toEqual([])
    const cut = buildExif(sample(true), true).subarray(0, 40)
    expect(() => parseExif(cut)).not.toThrow()
  })
})

const withExif = (entries: ExifEntry[], le = false) => {
  const tiff = buildExif(entries, le)
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const seg = Uint8Array.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body])
  return encodeJpeg(createImage(8, 8), { segments: [seg] })
}

describe('reading a summary', () => {
  test('words for the fields, coordinates as signed decimals, groups in a fixed order', () => {
    const m = readImageMetadata(withExif(sample(false)))!
    expect(m.groups.map((g) => g.title)).toEqual(['Camera', 'Photo', 'Date', 'Location', 'Picture'])
    const loc = m.groups.find((g) => g.title === 'Location')!.fields
    expect(loc[0]).toEqual({ label: 'Coordinates', value: '33.85833° S, 151.2° E' })
    expect(loc[1]).toEqual({ label: 'Altitude', value: '62.5 m' })
    expect(m.groups.find((g) => g.title === 'Photo')!.fields[0]).toEqual({ label: 'Exposure', value: '1/500 s' })
    expect(m.location).toBe(true)
    expect(m.extras).toContain('Camera maker notes')
    expect(m.orientation).toBe(6)
  })

  test('formats other than JPEG and PNG are not read', () => {
    expect(readImageMetadata(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0, 0]))).toBeNull()
  })

  test('a plain JPEG has nothing to report', () => {
    const m = readImageMetadata(encodeJpeg(createImage(8, 8)))!
    expect(m.groups).toEqual([])
    expect(m.location).toBe(false)
  })
})

describe('cleaning', () => {
  test('location only: the GPS directory, thumbnail and maker note go; the rest and the order of tags stay', () => {
    const out = cleanImageMetadata(withExif(sample(false)), 'location')
    const x = parseExif(readSegments(out).segments.find((s) => s.kind === 'exif')!.bytes.subarray(10))!
    expect(x.entries.some((a) => a.ifd === 'gps')).toBe(false)
    expect(x.entries.some((a) => a.tag === 0x927c)).toBe(false)
    expect(sorted(x.entries)).toEqual(sorted(sample(false).filter((a) => a.ifd !== 'gps' && a.tag !== 0x927c)))
  })

  test('everything: only a sideways orientation is kept', () => {
    const out = cleanImageMetadata(withExif(sample(false)), 'all')
    const x = parseExif(readSegments(out).segments.find((s) => s.kind === 'exif')!.bytes.subarray(10))!
    expect(sorted(x.entries)).toEqual(sorted([e('ifd0', 0x0112, 3, 1, short(6, false))]))
  })

  test('an EXIF block that cannot be read is dropped rather than risk keeping a location', () => {
    const bad = Uint8Array.from([0xff, 0xe1, 0, 12, 0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3, 4])
    const jpeg = encodeJpeg(createImage(8, 8), { segments: [bad] })
    expect(readSegments(cleanImageMetadata(jpeg, 'location')).segments.some((s) => s.kind === 'exif')).toBe(false)
  })

  test('XMP that mentions GPS goes with "location only", other XMP stays; "everything" drops both', () => {
    const xmp = (text: string) => {
      const body = [...ascii('http://ns.adobe.com/xap/1.0/'), ...Array.from(text, (c) => c.charCodeAt(0))]
      return Uint8Array.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body])
    }
    const kinds = (b: Uint8Array) => readSegments(b).segments.map((s) => s.kind)
    const gps = encodeJpeg(createImage(8, 8), { segments: [xmp('<x exif:GPSLatitude="1"/>')] })
    const plain = encodeJpeg(createImage(8, 8), { segments: [xmp('<x dc:title="holiday"/>')] })
    expect(kinds(cleanImageMetadata(gps, 'location'))).not.toContain('xmp')
    expect(kinds(cleanImageMetadata(plain, 'location'))).toContain('xmp')
    expect(kinds(cleanImageMetadata(plain, 'all'))).not.toContain('xmp')
    expect(readImageMetadata(gps)!.location).toBe(true)
  })

  test('comments and unknown application segments go with "everything"', () => {
    const com = Uint8Array.from([0xff, 0xfe, 0, 7, 104, 101, 108, 108, 111])
    const app = Uint8Array.from([0xff, 0xe5, 0, 6, 1, 2, 3, 4])
    const jpeg = encodeJpeg(createImage(8, 8), { segments: [com, app] })
    expect(readSegments(jpeg).segments.map((s) => s.kind)).toEqual(['jfif', 'comment', 'other'])
    expect(readSegments(cleanImageMetadata(jpeg, 'all')).segments.map((s) => s.kind)).toEqual(['jfif'])
    expect(readSegments(cleanImageMetadata(jpeg, 'location')).segments.map((s) => s.kind)).toEqual(['jfif', 'comment', 'other'])
  })
})

describe('PNG chunks', () => {
  test('the chunk list is read in order; colour chunks are picked out; non-PNG is refused', async () => {
    const png = await encodePng(createImage(4, 4))
    const types = readChunks(png)!.map((c) => c.type)
    expect(types[0]).toBe('IHDR')
    expect(types.at(-1)).toBe('IEND')
    const gama = Uint8Array.from([0, 0, 0, 4, 0x67, 0x41, 0x4d, 0x41, 0, 1, 0x86, 0xa0, 0, 0, 0, 0])
    const tagged = Uint8Array.from([...png.subarray(0, 33), ...gama, ...png.subarray(33)])
    expect(colourChunks(tagged).map((c) => String.fromCharCode(...c.subarray(4, 8)))).toEqual(['gAMA'])
    expect(readChunks(Uint8Array.from([1, 2, 3]))).toBeNull()
  })

  test('cleaning a PNG keeps its transparency chunk', async () => {
    const png = await encodePng(createImage(4, 4)) // fully transparent: a palette with a tRNS chunk
    expect(readChunks(png)!.some((c) => c.type === 'tRNS')).toBe(true)
    expect(readChunks(cleanImageMetadata(png, 'all'))!.map((c) => c.type)).toEqual(readChunks(png)!.map((c) => c.type))
  })
})
