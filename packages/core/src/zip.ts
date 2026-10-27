// Minimal ZIP writer and reader. `zip` stores (outputs are already compressed: PDF, JPG, PNG); `zipPacked` deflates what shrinks
// (the XML inside Office files). The reader is `unzip` in unzip.ts.
import { deflateRaw } from './flate.ts'

const table = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const b of data) c = table[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** "a.pdf" taken twice becomes "a.pdf" and "a (2).pdf" */
function uniqueNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    let out = name
    for (let n = 2; used.has(out); n++) {
      const dot = name.lastIndexOf('.')
      out = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`
    }
    used.add(out)
    return out
  })
}

type Packed = { name: string; bytes: Uint8Array; data: Uint8Array; method: 0 | 8 }

export function zip(files: { name: string; bytes: Uint8Array }[], now = new Date()): Uint8Array {
  return build(files.map((f) => ({ ...f, data: f.bytes, method: 0 })), now)
}

/** like `zip`, but each file is deflated when that makes it smaller */
export async function zipPacked(files: { name: string; bytes: Uint8Array }[], now = new Date()): Promise<Uint8Array> {
  const packed: Packed[] = []
  for (const f of files) {
    const d = f.bytes.length > 64 ? await deflateRaw(f.bytes) : f.bytes
    packed.push(d.length < f.bytes.length ? { ...f, data: d, method: 8 } : { ...f, data: f.bytes, method: 0 })
  }
  return build(packed, now)
}

function build(files: Packed[], now: Date): Uint8Array {
  const enc = new TextEncoder()
  const names = uniqueNames(files.map((f) => f.name)).map((n) => enc.encode(n))
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

  let size = 22
  files.forEach((f, i) => (size += 30 + 46 + 2 * names[i].length + f.data.length))
  if (files.length > 0xffff || size > 0xffffffff) throw new Error('Too large for a ZIP file')

  const out = new Uint8Array(size)
  const v = new DataView(out.buffer)
  let at = 0
  const offsets: number[] = []
  files.forEach((f, i) => {
    offsets.push(at)
    v.setUint32(at, 0x04034b50, true)
    v.setUint16(at + 4, 20, true)
    v.setUint16(at + 6, 0x0800, true) // UTF-8 names
    v.setUint16(at + 8, f.method, true)
    v.setUint16(at + 10, time, true)
    v.setUint16(at + 12, date, true)
    v.setUint32(at + 14, crc32(f.bytes), true)
    v.setUint32(at + 18, f.data.length, true)
    v.setUint32(at + 22, f.bytes.length, true)
    v.setUint16(at + 26, names[i].length, true)
    out.set(names[i], at + 30)
    out.set(f.data, at + 30 + names[i].length)
    at += 30 + names[i].length + f.data.length
  })
  const cdStart = at
  files.forEach((f, i) => {
    v.setUint32(at, 0x02014b50, true)
    v.setUint16(at + 4, 20, true)
    v.setUint16(at + 6, 20, true)
    v.setUint16(at + 8, 0x0800, true)
    v.setUint16(at + 10, f.method, true)
    v.setUint16(at + 12, time, true)
    v.setUint16(at + 14, date, true)
    v.setUint32(at + 16, crc32(f.bytes), true)
    v.setUint32(at + 20, f.data.length, true)
    v.setUint32(at + 24, f.bytes.length, true)
    v.setUint16(at + 28, names[i].length, true)
    v.setUint32(at + 42, offsets[i], true)
    out.set(names[i], at + 46)
    at += 46 + names[i].length
  })
  v.setUint32(at, 0x06054b50, true)
  v.setUint16(at + 8, files.length, true)
  v.setUint16(at + 10, files.length, true)
  v.setUint32(at + 12, at - cdStart, true)
  v.setUint32(at + 16, cdStart, true)
  return out
}
