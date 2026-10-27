// EXIF (a TIFF structure inside a JPEG or PNG): reading its fields, and writing a smaller copy that leaves some out.

export type IfdName = 'ifd0' | 'exif' | 'gps' | 'interop' | 'ifd1'

export type ExifEntry = {
  ifd: IfdName
  tag: number
  /** TIFF field type: 1 byte, 2 ascii, 3 short, 4 long, 5 rational, 7 undefined, 9 slong, 10 srational ... */
  type: number
  count: number
  /** the value bytes as stored (in the file's byte order) */
  data: Uint8Array
}

export type Exif = { le: boolean; entries: ExifEntry[]; thumbnail: boolean }

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8]

// pointers to other directories: they are rebuilt when writing, not kept as entries
const EXIF_POINTER = 0x8769
const GPS_POINTER = 0x8825
const INTEROP_POINTER = 0xa005
const THUMB_OFFSET = 0x0201
const THUMB_LENGTH = 0x0202
export const TAG = { orientation: 0x0112, makerNote: 0x927c } as const

/** parse a TIFF block; null when it isn't one */
export function parseExif(b: Uint8Array): Exif | null {
  if (b.length < 8 || (b[0] !== 0x49 && b[0] !== 0x4d) || b[0] !== b[1]) return null
  const le = b[0] === 0x49
  const u16 = (o: number) => (o + 2 <= b.length ? (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]) : 0)
  const u32 = (o: number) => (o + 4 <= b.length ? (le ? (u16(o) | (u16(o + 2) << 16)) >>> 0 : ((u16(o) << 16) | u16(o + 2)) >>> 0) : 0)
  if (u16(2) !== 42) return null
  const entries: ExifEntry[] = []
  const seen = new Set<number>()
  let thumbnail = false

  /** read one directory; returns the offset of the next one (0 for none) */
  const readIfd = (off: number, name: IfdName, depth: number): number => {
    if (off < 8 || off + 2 > b.length || seen.has(off)) return 0
    seen.add(off)
    const n = Math.min(u16(off), 1000)
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12
      if (e + 12 > b.length) break
      const tag = u16(e)
      const type = u16(e + 2)
      const count = u32(e + 4)
      const size = (TYPE_SIZE[type] ?? 0) * count
      if (!size) continue
      const at = size <= 4 ? e + 8 : u32(e + 8)
      if (at + size > b.length) continue
      if (type === 4 && depth < 3 && ((name === 'ifd0' && (tag === EXIF_POINTER || tag === GPS_POINTER)) || (name === 'exif' && tag === INTEROP_POINTER))) {
        readIfd(u32(e + 8), tag === EXIF_POINTER ? 'exif' : tag === GPS_POINTER ? 'gps' : 'interop', depth + 1)
        continue
      }
      if (name === 'ifd1' && (tag === THUMB_OFFSET || tag === THUMB_LENGTH)) {
        thumbnail = true
        continue
      }
      entries.push({ ifd: name, tag, type, count, data: b.slice(at, at + size) })
    }
    return u32(off + 2 + n * 12)
  }
  const next = readIfd(u32(4), 'ifd0', 0)
  if (next) readIfd(next, 'ifd1', 1)
  return { le, entries, thumbnail }
}

// ---------- values ----------

/** numbers of a numeric field (rationals divided out) */
export function numbersOf(e: ExifEntry, le: boolean): number[] {
  const d = new DataView(e.data.buffer, e.data.byteOffset, e.data.byteLength)
  const out: number[] = []
  const size = TYPE_SIZE[e.type]
  for (let i = 0; i < e.count && (i + 1) * size <= e.data.length; i++) {
    const o = i * size
    switch (e.type) {
      case 1:
      case 7:
        out.push(d.getUint8(o))
        break
      case 6:
        out.push(d.getInt8(o))
        break
      case 3:
        out.push(d.getUint16(o, le))
        break
      case 8:
        out.push(d.getInt16(o, le))
        break
      case 4:
        out.push(d.getUint32(o, le))
        break
      case 9:
        out.push(d.getInt32(o, le))
        break
      case 5:
        out.push(d.getUint32(o + 4, le) ? d.getUint32(o, le) / d.getUint32(o + 4, le) : 0)
        break
      case 10:
        out.push(d.getInt32(o + 4, le) ? d.getInt32(o, le) / d.getInt32(o + 4, le) : 0)
        break
      case 11:
        out.push(d.getFloat32(o, le))
        break
      case 12:
        out.push(d.getFloat64(o, le))
        break
    }
  }
  return out
}

export function textOf(e: ExifEntry): string {
  const end = e.data.indexOf(0)
  return new TextDecoder('utf-8', { fatal: false }).decode(end < 0 ? e.data : e.data.subarray(0, end)).trim()
}

// ---------- writing ----------

/**
 * A TIFF block holding just these entries, with the directories (main, EXIF, GPS, interoperability) rebuilt around them.
 * Thumbnails and anything not passed in are gone. Values keep the byte order of the original.
 */
export function buildExif(entries: ExifEntry[], le: boolean): Uint8Array {
  const dirs: Record<IfdName, ExifEntry[]> = { ifd0: [], exif: [], gps: [], interop: [], ifd1: [] }
  for (const e of entries) if (e.ifd !== 'ifd1') dirs[e.ifd].push(e)
  const hasInterop = dirs.interop.length > 0
  const hasExif = dirs.exif.length > 0 || hasInterop
  const hasGps = dirs.gps.length > 0
  const order: IfdName[] = ['ifd0', ...(hasExif ? (['exif'] as const) : []), ...(hasInterop ? (['interop'] as const) : []), ...(hasGps ? (['gps'] as const) : [])]

  // a directory points at its children, which are written after it
  type Row = { tag: number; type: number; count: number; data: Uint8Array | null; pointsTo?: IfdName }
  const rows = Object.fromEntries(order.map((name) => [name, dirs[name].map((e): Row => ({ tag: e.tag, type: e.type, count: e.count, data: e.data }))])) as Record<string, Row[]>
  const point = (parent: IfdName, tag: number, child: IfdName) => rows[parent].push({ tag, type: 4, count: 1, data: null, pointsTo: child })
  if (hasExif) point('ifd0', EXIF_POINTER, 'exif')
  if (hasGps) point('ifd0', GPS_POINTER, 'gps')
  if (hasInterop) point('exif', INTEROP_POINTER, 'interop')
  for (const name of order) rows[name].sort((p, q) => p.tag - q.tag) // directories list their tags in ascending order

  // where everything goes: header, then each directory's table followed by its out-of-line values
  const tableAt: Partial<Record<IfdName, number>> = {}
  let pos = 8
  for (const name of order) {
    tableAt[name] = pos
    pos += 2 + rows[name].length * 12 + 4 + rows[name].reduce((n, x) => n + (x.data && x.data.length > 4 ? (x.data.length + 1) & ~1 : 0), 0)
  }
  const out = new Uint8Array(pos)
  const v = new DataView(out.buffer)
  out[0] = out[1] = le ? 0x49 : 0x4d
  v.setUint16(2, 42, le)
  v.setUint32(4, 8, le)
  for (const name of order) {
    const r = rows[name]
    let at = tableAt[name]!
    v.setUint16(at, r.length, le)
    let valueAt = at + 2 + r.length * 12 + 4
    at += 2
    for (const x of r) {
      v.setUint16(at, x.tag, le)
      v.setUint16(at + 2, x.type, le)
      v.setUint32(at + 4, x.count, le)
      if (x.pointsTo) v.setUint32(at + 8, tableAt[x.pointsTo]!, le)
      else if (x.data!.length <= 4) out.set(x.data!, at + 8)
      else {
        v.setUint32(at + 8, valueAt, le)
        out.set(x.data!, valueAt)
        valueAt += (x.data!.length + 1) & ~1
      }
      at += 12
    }
    // the next-directory offset after the entries stays 0: no thumbnail directory
  }
  return out
}
