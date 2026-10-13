import { describe, expect, test } from 'vitest'
import { UserError, crc32, deflate } from '@ream/core'
import { createImage, decodePng, encodePng, ownCodec } from '../src/index.ts'

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}
const chunk = (type: string, data: Uint8Array) => {
  const head = new Uint8Array(4)
  new DataView(head.buffer).setUint32(0, data.length)
  const body = concat([ascii(type), data])
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32(body))
  return concat([head, body, crc])
}

/** apply PNG filter `ft` to packed rows (bpp = bytes per complete pixel, at least 1) */
function filterRows(rows: number[][], ft: number, bpp: number): number[] {
  const out: number[] = []
  rows.forEach((row, r) => {
    out.push(ft)
    row.forEach((x, i) => {
      const a = i >= bpp ? row[i - bpp] : 0
      const b = r > 0 ? rows[r - 1][i] : 0
      const c = i >= bpp && r > 0 ? rows[r - 1][i - bpp] : 0
      let p = 0
      if (ft === 1) p = a
      else if (ft === 2) p = b
      else if (ft === 3) p = (a + b) >> 1
      else if (ft === 4) {
        const q = a + b - c
        const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c)
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out.push((x - p) & 255)
    })
  })
  return out
}

async function buildPng(o: { w: number; h: number; depth: number; color: number; rows: number[][]; ft?: number; bpp?: number; plte?: number[]; trns?: number[]; interlace?: number }) {
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, o.w)
  v.setUint32(4, o.h)
  ihdr[8] = o.depth
  ihdr[9] = o.color
  ihdr[12] = o.interlace ?? 0
  const idat = await deflate(Uint8Array.from(filterRows(o.rows, o.ft ?? 0, o.bpp ?? 1)))
  return concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', ihdr),
    ...(o.plte ? [chunk('PLTE', Uint8Array.from(o.plte))] : []),
    ...(o.trns ? [chunk('tRNS', Uint8Array.from(o.trns))] : []),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ])
}
const rgba = (img: { data: Uint8ClampedArray }) => Array.from(img.data)

describe('encode / decode round trip', () => {
  test('RGBA with varied alpha survives exactly', async () => {
    const img = createImage(5, 4)
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 37 + (i >> 2) * 11) & 255
    const back = await decodePng(await encodePng(img))
    expect([back.width, back.height]).toEqual([5, 4])
    expect(rgba(back)).toEqual(rgba(img))
  })

  test('the codec wrapper reads PNG and refuses to write anything else', async () => {
    const img = createImage(2, 2)
    expect((await ownCodec.decode(await ownCodec.encode(img, 'image/png'), 'image/png')).width).toBe(2)
    await expect(ownCodec.encode(img, 'image/jpeg')).rejects.toThrow(UserError)
  })
})

describe('decoding other PNG layouts', () => {
  test('8-bit gray, all five filter types', async () => {
    const rows = [[0, 50, 100, 150], [200, 10, 255, 5], [1, 2, 3, 4]]
    for (const ft of [0, 1, 2, 3, 4]) {
      const img = await decodePng(await buildPng({ w: 4, h: 3, depth: 8, color: 0, rows, ft }))
      expect(Array.from({ length: 12 }, (_, i) => img.data[i * 4])).toEqual(rows.flat())
      expect(img.data[3]).toBe(255)
    }
  })

  test('RGB with every filter type (3 bytes per pixel)', async () => {
    const rows = [[10, 20, 30, 40, 50, 60], [70, 80, 90, 100, 110, 120]]
    for (const ft of [1, 2, 3, 4]) {
      const img = await decodePng(await buildPng({ w: 2, h: 2, depth: 8, color: 2, rows, ft, bpp: 3 }))
      expect(rgba(img)).toEqual([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255])
    }
  })

  test('RGBA with Paeth', async () => {
    const rows = [[1, 2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15, 16]]
    const img = await decodePng(await buildPng({ w: 2, h: 2, depth: 8, color: 6, rows, ft: 4, bpp: 4 }))
    expect(rgba(img)).toEqual(rows.flat())
  })

  test('1-bit gray unpacks and scales to 0/255', async () => {
    const img = await decodePng(await buildPng({ w: 8, h: 1, depth: 1, color: 0, rows: [[0b10101010]] }))
    expect(Array.from({ length: 8 }, (_, i) => img.data[i * 4])).toEqual([255, 0, 255, 0, 255, 0, 255, 0])
  })

  test('4-bit gray scales 15 to 255', async () => {
    const img = await decodePng(await buildPng({ w: 2, h: 1, depth: 4, color: 0, rows: [[0xf0]] }))
    expect([img.data[0], img.data[4]]).toEqual([255, 0])
  })

  test('2-bit palette with per-entry transparency', async () => {
    const img = await decodePng(
      await buildPng({ w: 4, h: 1, depth: 2, color: 3, rows: [[0b00011011]], plte: [255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9], trns: [255, 128, 0] }),
    )
    expect(rgba(img)).toEqual([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 9, 9, 255])
  })

  test('gray + alpha', async () => {
    const img = await decodePng(await buildPng({ w: 2, h: 1, depth: 8, color: 4, rows: [[10, 200, 20, 50]], bpp: 2 }))
    expect(rgba(img)).toEqual([10, 10, 10, 200, 20, 20, 20, 50])
  })

  test('16-bit RGB keeps the high bytes', async () => {
    const img = await decodePng(await buildPng({ w: 1, h: 1, depth: 16, color: 2, rows: [[0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]], bpp: 6 }))
    expect(rgba(img)).toEqual([0x12, 0x56, 0x9a, 255])
  })

  test('gray colour-key transparency (tRNS)', async () => {
    const img = await decodePng(await buildPng({ w: 2, h: 1, depth: 8, color: 0, rows: [[7, 9]], trns: [0, 7] }))
    expect([img.data[3], img.data[7]]).toEqual([0, 255])
  })
})

describe('bad input', () => {
  test('not a PNG', async () => {
    await expect(decodePng(ascii('GIF89a-and-more'))).rejects.toThrow("This isn't a PNG file.")
  })
  test('interlaced is refused with a clear message', async () => {
    await expect(decodePng(await buildPng({ w: 1, h: 1, depth: 8, color: 0, rows: [[1]], interlace: 1 }))).rejects.toThrow(/Interlaced/)
  })
  test('truncated pixel data is reported as damaged', async () => {
    const png = await buildPng({ w: 4, h: 4, depth: 8, color: 0, rows: [[1, 2, 3, 4]] })
    await expect(decodePng(png)).rejects.toThrow('damaged')
  })
  test('no image data', async () => {
    await expect(decodePng(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10))).rejects.toThrow('damaged')
  })
})
