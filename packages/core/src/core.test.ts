import { describe, expect, test } from 'vitest'
import { UserError, acceptsFile, checkLimits, crc32, formatBytes, unzip, zip, zipPacked } from './index.ts'

const enc = (s: string) => new TextEncoder().encode(s)

test('crc32 matches the standard check value', () => {
  expect(crc32(enc('123456789'))).toBe(0xcbf43926)
})

test('zip: readable central directory, data and unique names', () => {
  const out = zip([
    { name: 'a.pdf', bytes: enc('first') },
    { name: 'a.pdf', bytes: enc('second file') },
    { name: 'né.txt', bytes: new Uint8Array(0) },
  ])
  const v = new DataView(out.buffer)
  const eocd = out.length - 22
  expect(v.getUint32(eocd, true)).toBe(0x06054b50)
  expect(v.getUint16(eocd + 10, true)).toBe(3)
  let at = v.getUint32(eocd + 16, true)
  const seen: [string, string][] = []
  for (let i = 0; i < 3; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50)
    const crc = v.getUint32(at + 16, true)
    const size = v.getUint32(at + 20, true)
    const nameLen = v.getUint16(at + 28, true)
    const local = v.getUint32(at + 42, true)
    const name = new TextDecoder().decode(out.subarray(at + 46, at + 46 + nameLen))
    const start = local + 30 + v.getUint16(local + 26, true)
    const data = out.subarray(start, start + size)
    expect(crc32(data)).toBe(crc)
    seen.push([name, new TextDecoder().decode(data)])
    at += 46 + nameLen
  }
  expect(seen).toEqual([['a.pdf', 'first'], ['a (2).pdf', 'second file'], ['né.txt', '']])
})

test('acceptsFile: extension, exact mime and mime wildcard', () => {
  expect(acceptsFile({ name: 'X.PDF', type: '' }, ['.pdf'])).toBe(true)
  expect(acceptsFile({ name: 'a.png', type: 'image/png' }, ['image/*'])).toBe(true)
  expect(acceptsFile({ name: 'a.png', type: 'image/png' }, ['image/jpeg'])).toBe(false)
  expect(acceptsFile({ name: 'a.txt', type: 'text/plain' }, ['.pdf', 'image/*'])).toBe(false)
})

test('checkLimits explains what to do', () => {
  expect(() => checkLimits([{ name: 'big.pdf', size: 300 * 1024 ** 2 }])).toThrow(/big\.pdf is 300\.0 MB. The limit is 200\.0 MB per file/)
  expect(() => checkLimits(Array.from({ length: 51 }, (_, i) => ({ name: `${i}`, size: 1 })))).toThrow(UserError)
  expect(() => checkLimits(Array.from({ length: 4 }, (_, i) => ({ name: `${i}`, size: 150 * 1024 ** 2 })))).toThrow(/in total/)
  expect(() => checkLimits([{ name: 'ok.pdf', size: 1000 }])).not.toThrow()
  expect(formatBytes(1536)).toBe('2 KB')
})

describe('unzip', () => {
  const files = [
    { name: 'a.xml', bytes: enc('<a>'.repeat(500)) },
    { name: 'dir/b.txt', bytes: enc('tiny') },
    { name: 'empty', bytes: new Uint8Array(0) },
  ]
  const sorted = (m: Map<string, Uint8Array>) => [...m].map(([k, v]) => [k, new TextDecoder().decode(v)])
  const expected = files.map((f) => [f.name, new TextDecoder().decode(f.bytes)])

  test('reads what zip wrote, stored', async () => {
    expect(sorted(await unzip(zip(files)))).toEqual(expected)
  })
  test('reads deflated entries, and deflating shrinks the long one', async () => {
    const packed = await zipPacked(files)
    expect(packed.length).toBeLessThan(zip(files).length)
    expect(sorted(await unzip(packed))).toEqual(expected)
  })
  test('refuses text that is not a zip, a flipped byte and a size past the limit', async () => {
    await expect(unzip(enc('not a zip at all, long enough to look for a directory'))).rejects.toBeInstanceOf(UserError)
    const packed = await zipPacked(files)
    const broken = packed.slice()
    broken[40] ^= 0xff
    await expect(unzip(broken)).rejects.toBeInstanceOf(UserError)
    await expect(unzip(packed, { maxEntryBytes: 100 })).rejects.toThrow('size limit')
    await expect(unzip(packed, { maxEntries: 2 })).rejects.toThrow('more than')
  })
  test('a declared size smaller than the real one is not trusted', async () => {
    const packed = await zipPacked(files)
    const v = new DataView(packed.buffer)
    // central directory entry 0: uncompressed size (offset 24) lowered; the stream is cut at that size and the check fails
    const cd = v.getUint32(packed.length - 22 + 16, true)
    v.setUint32(cd + 24, 10, true)
    await expect(unzip(packed)).rejects.toBeInstanceOf(UserError)
  })
})
