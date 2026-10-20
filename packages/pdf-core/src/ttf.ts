// TrueType fonts for stamps: reading a .ttf, cutting it down to the glyphs a text uses, and writing it into a PDF as an
// embedded font (Type0 / CIDFontType2, Identity-H) so any script the font covers can be drawn and later selected or searched.
// Layout is one glyph after another with the font's own advance widths: no kerning, ligatures or shaping, so scripts that
// need shaping (Arabic, Indic) are not supported.
import { PdfRef, PdfStream, PdfString, name, type PdfObj } from './objects.ts'
import { PdfFontError } from './errors.ts'
import { ascii, concat } from './bytes.ts'
import { deflate, inflate } from './flate.ts'
import type { ObjectSink } from './outline.ts'

type Tables = Map<string, Uint8Array>

export type TtfFont = {
  /** the PostScript name, safe to use as a PDF name */
  name: string
  unitsPerEm: number
  numGlyphs: number
  ascent: number
  descent: number
  capHeight: number
  italicAngle: number
  bold: boolean
  fixedPitch: boolean
  /** xMin, yMin, xMax, yMax in font units */
  bbox: [number, number, number, number]
  advance(gid: number): number
  /** the glyph for a character, 0 (the missing-glyph box) when the font has none */
  glyphFor(cp: number): number
  tables: Tables
  /** PostScript (CFF) outlines, as in most .otf files: embedded whole, not cut down */
  cff?: boolean
}

const u16 = (v: DataView, o: number) => v.getUint16(o)
const i16 = (v: DataView, o: number) => v.getInt16(o)
const u32 = (v: DataView, o: number) => v.getUint32(o)
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

/** the table directory of the font at `base` in the file (0 for a plain font) */
export function readTables(bytes: Uint8Array, base = 0): Tables {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = u16(v, base + 4)
  const tables: Tables = new Map()
  for (let i = 0; i < count; i++) {
    const at = base + 12 + i * 16
    if (at + 16 > bytes.length) throw new PdfFontError("This font file is damaged: its table list is cut short.")
    const [offset, length] = [u32(v, at + 8), u32(v, at + 12)]
    if (offset + length > bytes.length) throw new PdfFontError('This font file is damaged: a table runs past the end of the file.')
    tables.set(tag(bytes, at), bytes.subarray(offset, offset + length))
  }
  return tables
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

/** the best Unicode character map: a function from code point to glyph */
function readCmap(t: Uint8Array): (cp: number) => number {
  const v = view(t)
  const subtables: { platform: number; encoding: number; offset: number }[] = []
  for (let i = 0; i < u16(v, 2); i++) subtables.push({ platform: u16(v, 4 + i * 8), encoding: u16(v, 6 + i * 8), offset: u32(v, 8 + i * 8) })
  const rank = (s: { platform: number; encoding: number }) => (s.platform === 3 && s.encoding === 10 ? 0 : s.platform === 0 && s.encoding >= 4 ? 1 : s.platform === 3 && s.encoding === 1 ? 2 : s.platform === 0 ? 3 : 9)
  const best = subtables.filter((s) => rank(s) < 9 && [4, 12].includes(u16(v, s.offset))).sort((a, b) => rank(a) - rank(b))[0]
  if (!best) throw new PdfFontError("This font has no Unicode character map, so Ream can't tell which letter is which glyph.")
  const o = best.offset
  if (u16(v, o) === 12) {
    const groups = u32(v, o + 12)
    return (cp) => {
      let [lo, hi] = [0, groups - 1]
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const [start, end, first] = [u32(v, o + 16 + mid * 12), u32(v, o + 20 + mid * 12), u32(v, o + 24 + mid * 12)]
        if (cp < start) hi = mid - 1
        else if (cp > end) lo = mid + 1
        else return first + cp - start
      }
      return 0
    }
  }
  const segs = u16(v, o + 6) / 2
  const ends = o + 14
  const starts = ends + segs * 2 + 2
  const deltas = starts + segs * 2
  const ranges = deltas + segs * 2
  return (cp) => {
    if (cp > 0xffff) return 0
    for (let i = 0; i < segs; i++) {
      if (cp > u16(v, ends + i * 2)) continue
      if (cp < u16(v, starts + i * 2)) return 0
      const range = u16(v, ranges + i * 2)
      if (range === 0) return (cp + u16(v, deltas + i * 2)) & 0xffff
      const at = ranges + i * 2 + range + (cp - u16(v, starts + i * 2)) * 2
      if (at + 2 > t.length) return 0
      const g = u16(v, at)
      return g === 0 ? 0 : (g + u16(v, deltas + i * 2)) & 0xffff
    }
    return 0
  }
}

/** the PostScript name from the font's naming table, or the family name; letters and digits only */
function readName(t: Uint8Array | undefined): string {
  if (!t) return 'Font'
  const v = view(t)
  const [count, strings] = [u16(v, 2), u16(v, 4)]
  const found = new Map<number, string>()
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12
    const [platform, id, length, offset] = [u16(v, r), u16(v, r + 6), u16(v, r + 8), u16(v, r + 10)]
    if (id !== 6 && id !== 1) continue
    const raw = t.subarray(strings + offset, strings + offset + length)
    let s = ''
    if (platform === 3 || platform === 0) for (let k = 0; k + 1 < raw.length; k += 2) s += String.fromCharCode((raw[k] << 8) | raw[k + 1])
    else s = String.fromCharCode(...raw)
    if (s && (!found.has(id) || platform === 3)) found.set(id, s)
  }
  return (found.get(6) ?? found.get(1) ?? 'Font').replace(/[^A-Za-z0-9-]/g, '') || 'Font'
}

/** the strings of a naming table by name ID (Windows Unicode entries preferred) */
function nameStrings(t: Uint8Array): Map<number, string> {
  const v = view(t)
  const [count, strings] = [u16(v, 2), u16(v, 4)]
  const found = new Map<number, string>()
  const fromWindows = new Set<number>()
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12
    const [platform, language, id, length, offset] = [u16(v, r), u16(v, r + 4), u16(v, r + 6), u16(v, r + 8), u16(v, r + 10)]
    const raw = t.subarray(strings + offset, strings + offset + length)
    let s = ''
    if (platform === 3 || platform === 0) for (let k = 0; k + 1 < raw.length; k += 2) s += String.fromCharCode((raw[k] << 8) | raw[k + 1])
    else s = String.fromCharCode(...raw)
    s = s.trim()
    // Windows English names win: they are what Office shows
    const windows = platform === 3 && (language === 0x409 || !fromWindows.has(id))
    if (s && (!found.has(id) || windows)) {
      found.set(id, s)
      if (platform === 3) fromWindows.add(id)
    }
  }
  return found
}

/** one face of a font file as Office and browsers list it */
export type FontFaceInfo = {
  /** name ID 1, the family Office uses ("Gill Sans Nova Light") */
  family: string
  /** name ID 16 when there is one, the family without the weight ("Gill Sans Nova") */
  typographic?: string
  /** "Regular", "Bold Italic", "Light" ... (name ID 17, else 2) */
  style: string
  postscript: string
  /** its licence allows embedding in documents, and Ream can embed its outlines */
  embeddable: boolean
}

/** every face in a font file (.ttf, .otf or each face of a .ttc), or [] when it isn't one */
export function fontFaces(bytes: Uint8Array): FontFaceInfo[] {
  try {
    const head4 = tag(bytes, 0)
    const offsets = head4 === 'ttcf' ? Array.from({ length: Math.min(u32(view(bytes), 8), 256) }, (_, i) => u32(view(bytes), 12 + i * 4)) : ['\x00\x01\x00\x00', 'true', 'OTTO'].includes(head4) ? [0] : []
    return offsets.flatMap((o) => {
      const tables = readTables(bytes, o)
      const t = tables.get('name')
      if (!t) return []
      const n = nameStrings(t)
      const family = n.get(1)
      const os2 = tables.get('OS/2')
      const fsType = os2 && os2.length >= 10 ? u16(view(os2), 8) : 0
      const cff = tables.get('CFF ')
      const embeddable = !(fsType & 0x0002) && !(fsType & 0x0200) && !(tables.has('CFF2') && !cff) && !(cff && cidKeyed(cff)) && (!!cff || tables.has('glyf'))
      return family ? [{ family, typographic: n.get(16), style: n.get(17) ?? n.get(2) ?? 'Regular', postscript: n.get(6) ?? family, embeddable }] : []
    })
  } catch {
    return []
  }
}

/**
 * The family name a font file gives itself (name ID 1, as Office lists fonts: "Gill Sans Nova Light"), or undefined. Works
 * for TrueType and OpenType files, and for the subsets PDFs embed when they keep the naming table.
 */
export function fontFamilyName(bytes: Uint8Array): string | undefined {
  return fontFaces(bytes)[0]?.family
}

/**
 * Read a TrueType font (.ttf, or one font of a .ttc: `face` is its number or PostScript name, default the first). Fonts
 * with PostScript (CFF) outlines, web fonts (decode them with `woffToSfnt` first) and fonts whose licence forbids
 * embedding are refused with a message saying so.
 */
export function parseTtf(bytes: Uint8Array, face: number | string = 0): TtfFont {
  if (bytes.length < 12) throw new PdfFontError("This isn't a font file.")
  const head4 = tag(bytes, 0)
  if (head4 === 'wOFF' || head4 === 'wOF2') throw new PdfFontError('This is a web font (.woff). Use a TrueType font (.ttf).')
  let base = 0
  if (head4 === 'ttcf') {
    const count = u32(view(bytes), 8)
    const offsets = Array.from({ length: Math.min(count, 256) }, (_, i) => u32(view(bytes), 12 + i * 4))
    if (typeof face === 'number') base = offsets[face] ?? offsets[0]
    else base = offsets.find((o) => readName(readTables(bytes, o).get('name')) === face.replace(/[^A-Za-z0-9-]/g, '')) ?? offsets[0]
  }
  else if (!['\x00\x01\x00\x00', 'true', 'OTTO'].includes(head4)) throw new PdfFontError("This isn't a TrueType or OpenType font (.ttf, .otf).")
  const tables = readTables(bytes, base)
  const cff = tables.has('CFF ')
  if (!cff && tables.has('CFF2')) throw new PdfFontError("This is a variable OpenType font (CFF2), which PDF can't hold. Use a static .otf or a .ttf.")
  for (const need of ['head', 'hhea', 'maxp', 'hmtx', 'cmap', ...(cff ? [] : ['loca', 'glyf'])]) {
    if (!tables.has(need)) throw new PdfFontError(`This font file is missing its ${need.trim()} table.`)
  }
  if (cff && cidKeyed(tables.get('CFF ')!)) throw new PdfFontError("This OpenType font numbers its glyphs by character collection (CID), as most Chinese, Japanese and Korean fonts do; Ream can't embed those yet. Use a .ttf of it.")
  const os2 = tables.get('OS/2')
  const fsType = os2 && os2.length >= 10 ? u16(view(os2), 8) : 0
  if (fsType & 0x0002 || fsType & 0x0200) throw new PdfFontError("This font's licence does not allow it to be embedded in documents. Choose another font.")

  const head = view(tables.get('head')!)
  const hhea = view(tables.get('hhea')!)
  const unitsPerEm = u16(head, 18) || 1000
  const numGlyphs = u16(view(tables.get('maxp')!), 4)
  const metrics = u16(hhea, 34)
  const hmtx = view(tables.get('hmtx')!)
  const post = tables.get('post')
  const ascent = i16(hhea, 4)
  const lookup = readCmap(tables.get('cmap')!)
  const capHeight = os2 && os2.length >= 90 && u16(view(os2), 0) >= 2 ? i16(view(os2), 88) : 0
  return {
    name: readName(tables.get('name')),
    unitsPerEm,
    numGlyphs,
    ascent,
    descent: i16(hhea, 6),
    capHeight: capHeight || Math.round(ascent * 0.7),
    italicAngle: post && post.length >= 8 ? view(post).getInt32(4) / 65536 : 0,
    bold: !!os2 && os2.length >= 6 && u16(view(os2), 4) >= 600,
    fixedPitch: !!post && post.length >= 16 && u32(view(post), 12) !== 0,
    bbox: [i16(head, 36), i16(head, 38), i16(head, 40), i16(head, 42)],
    advance: (gid) => (metrics ? u16(hmtx, Math.min(gid, metrics - 1) * 4) : 0),
    glyphFor: (cp) => {
      const g = lookup(cp)
      return g < numGlyphs ? g : 0
    },
    tables,
    cff,
  }
}

/** a CFF font program whose Top DICT starts with ROS: its glyphs are found by CID through a charset, not by number */
function cidKeyed(cff: Uint8Array): boolean {
  try {
    const hdr = cff[2]
    // skip the Name INDEX, then read the first entry of the Top DICT INDEX
    const index = (at: number) => {
      const count = (cff[at] << 8) | cff[at + 1]
      if (!count) return { start: at + 2, end: at + 2, first: [at + 2, at + 2] as [number, number] }
      const size = cff[at + 2]
      const off = (i: number) => { let v = 0; for (let k = 0; k < size; k++) v = (v << 8) | cff[at + 3 + i * size + k]; return v }
      const data = at + 3 + (count + 1) * size - 1
      return { start: at, end: data + off(count), first: [data + off(0), data + off(1)] as [number, number] }
    }
    const names = index(hdr)
    const [a, b] = index(names.end).first
    // operands come before their operator; ROS is the two-byte operator 12 30
    for (let i = a; i < b; i++) {
      const v = cff[i]
      if (v === 12) { if (cff[i + 1] === 30) return true; i++ }
      else if (v === 28) i += 2
      else if (v === 29) i += 4
      else if (v === 30) { while (i < b && (cff[i] & 0x0f) !== 0x0f && (cff[i] >> 4) !== 0x0f) i++ }
      else if (v >= 247 && v <= 254) i += 1
    }
    return false
  } catch {
    return false
  }
}

/** a WOFF 1 web font turned back into the TrueType file it was made from (each table is inflated when it was compressed) */
export async function woffToSfnt(woff: Uint8Array): Promise<Uint8Array> {
  const v = view(woff)
  if (woff.length < 44 || tag(woff, 0) !== 'wOFF') throw new PdfFontError("This isn't a WOFF font.")
  const flavor = u32(v, 4)
  const count = u16(v, 12)
  const tables: { tag: string; data: Uint8Array }[] = []
  for (let i = 0; i < count; i++) {
    const at = 44 + i * 20
    if (at + 20 > woff.length) throw new PdfFontError('This font file is damaged.')
    const [offset, comp, orig] = [u32(v, at + 4), u32(v, at + 8), u32(v, at + 12)]
    if (offset + comp > woff.length || orig > 64 * 1024 * 1024) throw new PdfFontError('This font file is damaged.')
    const raw = woff.subarray(offset, offset + comp)
    const data = comp < orig ? await inflate(raw) : raw
    tables.push({ tag: tag(woff, at), data })
  }
  const head = 12 + 16 * count
  const out = new Uint8Array(head + tables.reduce((n, t) => n + ((t.data.length + 3) & ~3), 0))
  const o = view(out)
  o.setUint32(0, flavor)
  o.setUint16(4, count)
  let pow = 1
  while (pow * 2 <= count) pow *= 2
  o.setUint16(6, pow * 16)
  o.setUint16(8, Math.log2(pow))
  o.setUint16(10, count * 16 - pow * 16)
  let at = head
  tables.forEach((t, i) => {
    const r = 12 + i * 16
    for (let k = 0; k < 4; k++) out[r + k] = t.tag.charCodeAt(k)
    o.setUint32(r + 4, checksum(t.data))
    o.setUint32(r + 8, at)
    o.setUint32(r + 12, t.data.length)
    out.set(t.data, at)
    at += (t.data.length + 3) & ~3
  })
  return out
}

// ---------- subsetting ----------

/** the glyphs a composite glyph is built from */
function components(glyph: Uint8Array): number[] {
  if (glyph.length < 10) return []
  const v = view(glyph)
  if (i16(v, 0) >= 0) return []
  const out: number[] = []
  let at = 10
  for (;;) {
    if (at + 4 > glyph.length) break
    const flags = u16(v, at)
    out.push(u16(v, at + 2))
    at += 4 + (flags & 1 ? 4 : 2) + (flags & 0x08 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0)
    if (!(flags & 0x20)) break
  }
  return out
}

const checksum = (b: Uint8Array) => {
  let sum = 0
  for (let i = 0; i < b.length; i += 4) sum = (sum + (((b[i] << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0)) >>> 0
  return sum
}
const pad4 = (b: Uint8Array) => {
  if (b.length % 4 === 0) return b
  const out = new Uint8Array(b.length + (4 - (b.length % 4)))
  out.set(b)
  return out
}

/**
 * The font cut down to the glyphs in `gids` (and the parts of composite glyphs they use). Glyph numbers stay as they
 * were, so the PDF can use them directly; the glyphs not kept are empty.
 */
export function subsetTtf(font: TtfFont, gids: Iterable<number>): Uint8Array {
  const t = font.tables
  const headV = view(t.get('head')!)
  const longLoca = i16(headV, 50) === 1
  const loca = view(t.get('loca')!)
  const glyf = t.get('glyf')!
  const slice = (g: number) => {
    const [a, b] = longLoca ? [u32(loca, g * 4), u32(loca, g * 4 + 4)] : [u16(loca, g * 2) * 2, u16(loca, g * 2 + 2) * 2]
    return a < b && b <= glyf.length ? glyf.subarray(a, b) : new Uint8Array(0)
  }
  const keep = new Set<number>([0])
  const queue = [...gids]
  while (queue.length) {
    const g = queue.pop()!
    if (g < 0 || g >= font.numGlyphs || keep.has(g)) continue
    keep.add(g)
    queue.push(...components(slice(g)))
  }
  const parts: Uint8Array[] = []
  const offsets = new Uint32Array(font.numGlyphs + 1)
  let at = 0
  for (let g = 0; g < font.numGlyphs; g++) {
    offsets[g] = at
    if (keep.has(g)) {
      const p = pad4(slice(g))
      parts.push(p)
      at += p.length
    }
  }
  offsets[font.numGlyphs] = at
  const newLoca = new Uint8Array((font.numGlyphs + 1) * 4)
  const lv = view(newLoca)
  offsets.forEach((o, i) => lv.setUint32(i * 4, o))
  const newHead = t.get('head')!.slice()
  view(newHead).setInt16(50, 1) // long offsets
  view(newHead).setUint32(8, 0) // checkSumAdjustment, set by writeSfnt
  const out = new Map<string, Uint8Array>([
    ['glyf', concat(parts)],
    ['head', newHead],
    ['hhea', t.get('hhea')!],
    ['hmtx', t.get('hmtx')!],
    ['loca', newLoca],
    ['maxp', t.get('maxp')!],
  ])
  for (const k of ['cvt ', 'fpgm', 'prep']) if (t.has(k)) out.set(k, t.get(k)!)
  return writeSfnt(out, 0x00010000)
}

/** a font file from its tables; `version` is 0x00010000 for TrueType outlines, 'OTTO' for CFF ones */
function writeSfnt(out: Map<string, Uint8Array>, version: number): Uint8Array {
  const names = [...out.keys()].sort()
  const dirEnd = 12 + names.length * 16
  const chunks: Uint8Array[] = []
  const header = new Uint8Array(dirEnd)
  const hv = view(header)
  hv.setUint32(0, version)
  hv.setUint16(4, names.length)
  const log = Math.floor(Math.log2(names.length))
  hv.setUint16(6, 2 ** log * 16)
  hv.setUint16(8, log)
  hv.setUint16(10, names.length * 16 - 2 ** log * 16)
  let pos = dirEnd
  names.forEach((n, i) => {
    const data = out.get(n)!
    const padded = pad4(data)
    header.set(ascii(n), 12 + i * 16)
    hv.setUint32(16 + i * 16, checksum(padded))
    hv.setUint32(20 + i * 16, pos)
    hv.setUint32(24 + i * 16, data.length)
    chunks.push(padded)
    pos += padded.length
  })
  const file = concat([header, ...chunks])
  // the whole-file checksum goes into the head table so readers can tell the file is intact
  const headAt = names.indexOf('head')
  const headOffset = view(file).getUint32(20 + headAt * 16)
  view(file).setUint32(headOffset + 8, (0xb1b0afba - checksum(file)) >>> 0)
  return file
}

/** one face of an OpenType (CFF) font as a file of its own, with the tables a PDF reader needs */
function otfFile(font: TtfFont): Uint8Array {
  const out = new Map<string, Uint8Array>()
  for (const k of ['CFF ', 'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post']) if (font.tables.has(k)) out.set(k, font.tables.get(k)!)
  const head = out.get('head')!.slice()
  view(head).setUint32(8, 0)
  out.set('head', head)
  return writeSfnt(out, 0x4f54544f)
}

// ---------- embedding ----------

/** a font ready to draw one text with: its glyphs chosen and its file made, but not yet written into any document */
export type PreparedFont = {
  /** the text as glyph numbers in hex, ready for a `Tj` */
  encode(text: string): string
  /** width of the text in points at `size`, from the font's own advances (no kerning) */
  width(text: string, size: number): number
  /** height of a capital letter and the depth below the baseline, in points at `size` */
  capHeight(size: number): number
  descent(size: number): number
  /** put the font's objects in a document and give back the font to refer to; `extra` entries go in the font dictionary */
  write(into: ObjectSink, extra?: Map<string, PdfObj>): PdfRef
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0')
/** a character as UTF-16 in hex, for a ToUnicode map */
const utf16 = (cp: number) => (cp > 0xffff ? hex4(0xd800 + ((cp - 0x10000) >> 10)) + hex4(0xdc00 + ((cp - 0x10000) & 0x3ff)) : hex4(cp))

function toUnicodeMap(pairs: [number, number][]): string {
  const blocks: string[] = []
  for (let i = 0; i < pairs.length; i += 100) {
    const part = pairs.slice(i, i + 100)
    blocks.push(`${part.length} beginbfchar\n${part.map(([g, cp]) => `<${hex4(g)}> <${utf16(cp)}>`).join('\n')}\nendbfchar`)
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`
}

/**
 * Make a font from a .ttf for drawing `text`. Throws a readable error when the font can't be used or has no letter
 * for a character in the text. Only the glyphs of this text are kept in the PDF.
 */
export async function prepareFont(source: Uint8Array | TtfFont, text: string): Promise<PreparedFont> {
  const font = source instanceof Uint8Array ? parseTtf(source) : source
  const chars = [...text.normalize('NFC')].map((c) => c.codePointAt(0)!)
  const missing = [...new Set(chars.filter((cp) => cp >= 32 && !font.glyphFor(cp)))]
  if (missing.length) throw new PdfFontError(`This font has no ${missing.length === 1 ? 'glyph' : 'glyphs'} for "${missing.slice(0, 6).map((c) => String.fromCodePoint(c)).join('')}". Choose a font that includes ${missing.length === 1 ? 'it' : 'them'}.`)
  const used = new Map<number, number>() // glyph -> a character it stands for
  for (const cp of chars) if (cp >= 32) used.set(font.glyphFor(cp), used.get(font.glyphFor(cp)) ?? cp)
  // ponytail: CFF outlines are embedded whole (cutting a CFF font down is its own project); a .ttf is cut to the text's glyphs
  const subset = font.cff ? otfFile(font) : subsetTtf(font, used.keys())
  const fileLength = subset.length
  const file = await deflate(subset)
  const unicode = await deflate(ascii(toUnicodeMap([...used].sort(([a], [b]) => a - b))))
  const scale = 1000 / font.unitsPerEm
  const mid = (n: number) => Math.round(n * scale)
  const tagLetters = (() => {
    let h = 2166136261
    for (const g of used.keys()) h = Math.imul(h ^ g, 16777619) >>> 0
    return Array.from({ length: 6 }, (_, i) => String.fromCharCode(65 + ((h >>> (i * 5)) % 26))).join('')
  })()
  const baseName = `${tagLetters}+${font.name}`
  const encode = (s: string) => `<${[...s.normalize('NFC')].map((c) => hex4(font.glyphFor(c.codePointAt(0)!))).join('')}>`
  return {
    encode,
    width: (s, size) => ([...s.normalize('NFC')].reduce((sum, c) => sum + font.advance(font.glyphFor(c.codePointAt(0)!)), 0) * size) / font.unitsPerEm,
    capHeight: (size) => (font.capHeight * size) / font.unitsPerEm,
    descent: (size) => (Math.abs(font.descent) * size) / font.unitsPerEm,
    write(into, extra) {
      const add = (o: PdfObj) => {
        const r = into.reserve()
        into.set(r, o)
        return r
      }
      const fontFile = add(new PdfStream(new Map<string, PdfObj>(font.cff ? [['Subtype', name('OpenType')], ['Filter', name('FlateDecode')]] : [['Length1', fileLength], ['Filter', name('FlateDecode')]]), file))
      const descriptor = add(
        new Map<string, PdfObj>([
          ['Type', name('FontDescriptor')],
          ['FontName', name(baseName)],
          ['Flags', 32 | (font.italicAngle ? 64 : 0) | (font.fixedPitch ? 1 : 0)],
          ['FontBBox', font.bbox.map(mid)],
          ['ItalicAngle', Math.round(font.italicAngle * 100) / 100],
          ['Ascent', mid(font.ascent)],
          ['Descent', mid(font.descent)],
          ['CapHeight', mid(font.capHeight)],
          ['StemV', font.bold ? 120 : 80],
          [font.cff ? 'FontFile3' : 'FontFile2', fontFile],
        ]),
      )
      const widths: PdfObj[] = []
      for (const g of [...used.keys()].sort((a, b) => a - b)) widths.push(g, [mid(font.advance(g))])
      const cid = add(
        new Map<string, PdfObj>([
          ['Type', name('Font')],
          // a CFF font that isn't CID-keyed takes CIDs as glyph numbers, so Identity-H codes select glyphs as with TrueType
          ['Subtype', name(font.cff ? 'CIDFontType0' : 'CIDFontType2')],
          ['BaseFont', name(baseName)],
          ['CIDSystemInfo', new Map<string, PdfObj>([['Registry', new PdfString(ascii('Adobe'))], ['Ordering', new PdfString(ascii('Identity'))], ['Supplement', 0]])],
          ['FontDescriptor', descriptor],
          ...(font.cff ? [] : ([['CIDToGIDMap', name('Identity')]] as [string, PdfObj][])),
          ['DW', 1000],
          ['W', widths],
        ]),
      )
      const toUnicode = add(new PdfStream(new Map<string, PdfObj>([['Filter', name('FlateDecode')]]), unicode))
      return add(
        new Map<string, PdfObj>([
          ['Type', name('Font')],
          ['Subtype', name('Type0')],
          ['BaseFont', name(baseName)],
          ['Encoding', name('Identity-H')],
          ['DescendantFonts', [cid]],
          ['ToUnicode', toUnicode],
          ...(extra ?? []),
        ]),
      )
    },
  }
}
