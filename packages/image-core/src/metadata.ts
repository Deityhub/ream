// What a JPEG or PNG says about itself besides its pixels (camera, date, location ...), in words, and a copy of the file
// without some or all of it. The picture data is never touched, so cleaning loses no quality.
import { crc32 } from '@ream/core'
import { TAG, buildExif, numbersOf, parseExif, textOf, type Exif, type ExifEntry, type IfdName } from './exif.ts'
import { readSegments, rewriteSegments } from './jpeg/segments.ts'
import { readChunks, type PngChunk } from './png-chunks.ts'

export type MetadataField = { label: string; value: string }
export type MetadataGroup = { title: string; fields: MetadataField[] }
export type MetadataSummary = {
  groups: MetadataGroup[]
  /** the file says where it was taken */
  location: boolean
  /** things stored besides the fields above, for the notes under the list */
  extras: string[]
  /** EXIF orientation 1..8 */
  orientation: number
}

export type CleanMode = 'all' | 'location'

const ORIENTATION = ['', 'Normal', 'Mirrored', 'Upside down', 'Flipped vertically', 'Mirrored, turned left', 'Turned right', 'Mirrored, turned right', 'Turned left']
const EXPOSURE_PROGRAM = ['Not defined', 'Manual', 'Normal', 'Aperture priority', 'Shutter priority', 'Creative', 'Action', 'Portrait', 'Landscape']
const METERING = ['Unknown', 'Average', 'Center-weighted', 'Spot', 'Multi-spot', 'Pattern', 'Partial']
const WHITE_BALANCE = ['Auto', 'Manual']

type Describe = { group: string; label: string; format?: (e: ExifEntry, le: boolean) => string }

const num = (e: ExifEntry, le: boolean) => numbersOf(e, le)[0]
const trim = (n: number, digits = 2) => String(+n.toFixed(digits))
const date = (e: ExifEntry) => textOf(e).replace(/^(\d{4}):(\d\d):(\d\d)/, '$1-$2-$3')
const at = (list: string[]) => (e: ExifEntry, le: boolean) => list[num(e, le)] ?? String(num(e, le))

// the tags worth showing, by directory
const KNOWN: Record<string, Describe> = {
  'ifd0:271': { group: 'Camera', label: 'Make' },
  'ifd0:272': { group: 'Camera', label: 'Model' },
  'exif:42036': { group: 'Camera', label: 'Lens' },
  'exif:42034': { group: 'Camera', label: 'Lens details', format: (e, le) => numbersOf(e, le).map((n) => trim(n)).join(', ') },
  'exif:42033': { group: 'Camera', label: 'Camera serial number' },
  'exif:42032': { group: 'Camera', label: 'Owner' },
  'ifd0:305': { group: 'Camera', label: 'Software' },
  'exif:33434': { group: 'Photo', label: 'Exposure', format: (e, le) => (num(e, le) >= 1 ? `${trim(num(e, le))} s` : `1/${Math.round(1 / num(e, le))} s`) },
  'exif:33437': { group: 'Photo', label: 'Aperture', format: (e, le) => `f/${trim(num(e, le), 1)}` },
  'exif:34855': { group: 'Photo', label: 'ISO', format: (e, le) => String(num(e, le)) },
  'exif:37386': { group: 'Photo', label: 'Focal length', format: (e, le) => `${trim(num(e, le), 1)} mm` },
  'exif:41989': { group: 'Photo', label: 'Focal length (35 mm)', format: (e, le) => `${num(e, le)} mm` },
  'exif:34850': { group: 'Photo', label: 'Program', format: at(EXPOSURE_PROGRAM) },
  'exif:37383': { group: 'Photo', label: 'Metering', format: at(METERING) },
  'exif:37385': { group: 'Photo', label: 'Flash', format: (e, le) => (num(e, le) & 1 ? 'Fired' : 'Did not fire') },
  'exif:41987': { group: 'Photo', label: 'White balance', format: at(WHITE_BALANCE) },
  'ifd0:306': { group: 'Date', label: 'Modified', format: date },
  'exif:36867': { group: 'Date', label: 'Taken', format: date },
  'exif:36868': { group: 'Date', label: 'Digitized', format: date },
  'ifd0:270': { group: 'Text', label: 'Description' },
  'ifd0:315': { group: 'Text', label: 'Artist' },
  'ifd0:33432': { group: 'Text', label: 'Copyright' },
  'exif:37510': { group: 'Text', label: 'Comment', format: (e) => new TextDecoder().decode(e.data.subarray(8)).replace(/\0+$/, '').trim() },
  'exif:42016': { group: 'Text', label: 'Unique picture ID' },
  'ifd0:274': { group: 'Picture', label: 'Orientation', format: (e, le) => ORIENTATION[num(e, le)] ?? String(num(e, le)) },
  'exif:40962': { group: 'Picture', label: 'Width', format: (e, le) => `${num(e, le)} px` },
  'exif:40963': { group: 'Picture', label: 'Height', format: (e, le) => `${num(e, le)} px` },
}
const GROUP_ORDER = ['Camera', 'Photo', 'Date', 'Location', 'Text', 'Picture']

const entryKey = (e: ExifEntry) => `${e.ifd}:${e.tag}`
const find = (x: Exif, ifd: IfdName, tag: number) => x.entries.find((e) => e.ifd === ifd && e.tag === tag)
const orientationOf = (x: Exif) => {
  const e = find(x, 'ifd0', TAG.orientation)
  return e ? num(e, x.le) : 1
}

/** degrees, minutes, seconds (three rationals) and the N/S/E/W letter to a signed decimal */
function coordinate(x: Exif, valueTag: number, refTag: number): number | null {
  const v = find(x, 'gps', valueTag)
  const ref = find(x, 'gps', refTag)
  if (!v) return null
  const [d = 0, m = 0, s = 0] = numbersOf(v, x.le)
  const sign = ref && /^[SW]/i.test(textOf(ref)) ? -1 : 1
  return sign * (d + m / 60 + s / 3600)
}

function describeExif(x: Exif): { groups: Record<string, MetadataField[]>; location: boolean } {
  const groups: Record<string, MetadataField[]> = {}
  const add = (group: string, label: string, value: string) => value && (groups[group] ??= []).push({ label, value })
  for (const e of x.entries) {
    const d = KNOWN[entryKey(e)]
    if (!d) continue
    let value: string
    try {
      value = d.format ? d.format(e, x.le) : e.type === 2 ? textOf(e) : numbersOf(e, x.le).map((n) => trim(n)).join(', ')
    } catch {
      continue
    }
    add(d.group, d.label, value)
  }
  const lat = coordinate(x, 2, 1)
  const lon = coordinate(x, 4, 3)
  const hasGps = x.entries.some((e) => e.ifd === 'gps')
  if (lat !== null && lon !== null) {
    add('Location', 'Coordinates', `${trim(Math.abs(lat), 5)}° ${lat < 0 ? 'S' : 'N'}, ${trim(Math.abs(lon), 5)}° ${lon < 0 ? 'W' : 'E'}`)
  } else if (hasGps) add('Location', 'Location data', 'present')
  const alt = find(x, 'gps', 6)
  if (alt) add('Location', 'Altitude', `${trim(num(alt, x.le), 1)} m`)
  const heading = find(x, 'gps', 17)
  if (heading) add('Location', 'Direction', `${trim(num(heading, x.le), 0)}°`)
  const stamp = find(x, 'gps', 29)
  if (stamp) add('Location', 'GPS date', textOf(stamp).replace(/:/g, '-'))
  return { groups, location: hasGps }
}

// ---------- reading ----------

type Found = { exif: Exif | null; xmp: string | null; extras: string[]; text: [string, string][] }

/** the metadata blocks of a JPEG */
function readJpeg(b: Uint8Array): Found {
  const found: Found = { exif: null, xmp: null, extras: [], text: [] }
  const { segments } = readSegments(b)
  let comments = 0
  for (const s of segments) {
    if (s.kind === 'exif') found.exif ??= parseExif(s.bytes.subarray(10))
    else if (s.kind === 'xmp') found.xmp = new TextDecoder().decode(s.bytes.subarray(33))
    else if (s.kind === 'iptc') found.extras.push('Caption and keyword block (IPTC)')
    else if (s.kind === 'icc') found.extras.includes('Colour profile') || found.extras.push('Colour profile')
    else if (s.kind === 'comment') {
      comments++
      found.text.push(['Comment', new TextDecoder().decode(s.bytes.subarray(4)).replace(/\0+$/, '').trim()])
    }
  }
  if (jpegTrailer(b) > 0) found.extras.push('Extra data after the picture (for example a motion photo)')
  return found
}

/** an iTXt chunk: keyword, compression flag and method, language tag, translated keyword, then the text */
function iTxt(data: Uint8Array): { text: string; compressed: boolean } {
  const key = data.indexOf(0)
  const lang = data.indexOf(0, key + 3)
  const translated = data.indexOf(0, lang + 1)
  return { compressed: data[key + 1] === 1, text: new TextDecoder().decode(data.subarray(translated + 1)) }
}

function readPng(b: Uint8Array): Found {
  const found: Found = { exif: null, xmp: null, extras: [], text: [] }
  for (const c of readChunks(b) ?? []) {
    const data = c.bytes.subarray(8, c.bytes.length - 4)
    if (c.type === 'eXIf') found.exif ??= parseExif(data)
    else if (c.type === 'iCCP') found.extras.push('Colour profile')
    else if (c.type === 'tIME') found.extras.push('Last-saved time')
    else if (c.type === 'tEXt') {
      const nul = data.indexOf(0)
      if (nul > 0) found.text.push([new TextDecoder('latin1').decode(data.subarray(0, nul)), new TextDecoder('latin1').decode(data.subarray(nul + 1))])
    } else if (c.type === 'iTXt' || c.type === 'zTXt') {
      const t = c.type === 'iTXt' ? iTxt(data) : null
      const nul = data.indexOf(0)
      const key = new TextDecoder('latin1').decode(data.subarray(0, Math.max(0, nul)))
      if (key === 'XML:com.adobe.xmp') found.xmp = t?.text ?? ''
      else found.text.push([key, t && !t.compressed ? t.text : '(compressed)'])
    }
  }
  return found
}

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

/** what a picture file says about itself, or null for formats this doesn't read */
export function readImageMetadata(b: Uint8Array): MetadataSummary | null {
  if (!isJpeg(b) && !isPng(b)) return null
  const f = isJpeg(b) ? readJpeg(b) : readPng(b)
  const { groups, location } = f.exif ? describeExif(f.exif) : { groups: {}, location: false }
  for (const [k, v] of f.text) if (v) (groups.Text ??= []).push({ label: k, value: v.length > 200 ? v.slice(0, 200) + '…' : v })
  const extras = [...new Set(f.extras)]
  if (f.exif?.thumbnail) extras.push('Small preview picture')
  if (f.exif?.entries.some((e) => e.tag === TAG.makerNote)) extras.push('Camera maker notes')
  if (f.xmp) extras.push('Editing history and details (XMP)')
  const xmpLocation = !!f.xmp && /GPS(Latitude|Longitude)/.test(f.xmp)
  return {
    groups: GROUP_ORDER.filter((g) => groups[g]?.length).map((title) => ({ title, fields: groups[title] })),
    location: location || xmpLocation,
    extras,
    orientation: (f.exif && orientationOf(f.exif)) || 1,
  }
}

// ---------- cleaning ----------

/** where a JPEG's data really ends: just after its last EOI marker; bytes after that are a trailer */
function jpegTrailer(b: Uint8Array): number {
  let i = 2
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return 0 // not a marker where one should be: leave the file alone
    const m = b[i + 1]
    if (m === 0xff) {
      i++
      continue
    }
    if (m === 0xd9) return b.length - (i + 2)
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
      i += 2
      continue
    }
    const len = (b[i + 2] << 8) | b[i + 3]
    i += 2 + len
    if (m === 0xda) {
      // entropy-coded data runs to the next marker that isn't a stuffed byte or a restart
      while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0 && !(b[i + 1] >= 0xd0 && b[i + 1] <= 0xd7))) i++
    }
  }
  return 0
}

const hasGpsXmp = (xmp: string) => /GPS/.test(xmp)

/** a minimal EXIF holding only what this entry list says, or null when it would be empty */
function rebuilt(x: Exif, keep: (e: ExifEntry) => boolean): Uint8Array | null {
  const entries = x.entries.filter(keep)
  return entries.length ? buildExif(entries, x.le) : null
}

const keepOrientationOnly = (e: ExifEntry, le: boolean) => e.ifd === 'ifd0' && e.tag === TAG.orientation && num(e, le) !== 1
// location only: leave out the GPS directory, the thumbnail (which can show what was cropped away) and the maker notes (which can hold positions too)
const withoutLocation = (e: ExifEntry) => e.ifd !== 'gps' && e.ifd !== 'ifd1' && e.tag !== TAG.makerNote

function segment(marker: number, header: number[], body: Uint8Array): Uint8Array {
  const len = 2 + header.length + body.length
  const out = new Uint8Array(2 + len)
  out.set([0xff, marker, len >> 8, len & 255, ...header])
  out.set(body, 4 + header.length)
  return out
}
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0]

/** a copy of the file with this metadata removed; 'all' keeps the colour profile and the orientation (so the picture still shows upright) */
export function cleanImageMetadata(b: Uint8Array, mode: CleanMode): Uint8Array {
  if (isJpeg(b)) {
    const trailer = jpegTrailer(b)
    const body = mode === 'all' && trailer > 0 ? b.subarray(0, b.length - trailer) : b
    return rewriteSegments(body, (s) => {
      if (s.kind === 'exif') {
        const x = parseExif(s.bytes.subarray(10))
        // an EXIF block we can't read can't be checked for a location either
        if (!x) return null
        const tiff = mode === 'all' ? rebuilt(x, (e) => keepOrientationOnly(e, x.le)) : rebuilt(x, withoutLocation)
        return tiff ? segment(0xe1, EXIF_HEADER, tiff) : null
      }
      if (s.kind === 'xmp') return mode === 'all' || hasGpsXmp(new TextDecoder().decode(s.bytes)) ? null : s.bytes
      if (mode === 'all' && (s.kind === 'iptc' || s.kind === 'comment' || s.kind === 'other')) return null
      return s.bytes
    })
  }
  if (isPng(b)) {
    const chunks = readChunks(b)
    if (!chunks) return b
    const parts: Uint8Array[] = [b.subarray(0, 8)]
    for (const c of chunks) parts.push(...cleanPngChunk(c, mode))
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
    return out
  }
  return b
}

function pngChunk(type: string, data: Uint8Array, crc: (b: Uint8Array) => number): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
  return out
}

function cleanPngChunk(c: PngChunk, mode: CleanMode): Uint8Array[] {
  const critical = c.type.charCodeAt(0) < 97
  if (critical) return [c.bytes]
  const data = c.bytes.subarray(8, c.bytes.length - 4)
  if (c.type === 'eXIf') {
    const x = parseExif(data)
    if (!x) return []
    const tiff = mode === 'all' ? rebuilt(x, (e) => keepOrientationOnly(e, x.le)) : rebuilt(x, withoutLocation)
    return tiff ? [pngChunk('eXIf', tiff, crc32)] : []
  }
  if (c.type === 'tEXt' || c.type === 'zTXt' || c.type === 'iTXt') {
    if (mode === 'all') return []
    const nul = data.indexOf(0)
    const key = new TextDecoder('latin1').decode(data.subarray(0, Math.max(0, nul)))
    // location only: drop an XMP packet that has coordinates; (compressed XMP can't be read, so it goes too)
    if (key === 'XML:com.adobe.xmp') return c.type === 'iTXt' && !iTxt(data).compressed && !hasGpsXmp(iTxt(data).text) ? [c.bytes] : []
    return [c.bytes]
  }
  if (c.type === 'tIME') return mode === 'all' ? [] : [c.bytes]
  return [c.bytes]
}
