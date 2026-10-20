import { PdfName, PdfStream, PdfString, decodeStream, decodeTextString, fontFamilyName, isDict, type PdfDict, type PdfDocument, type PdfObj } from '@ream/pdf-core'
import { parseToUnicode, type ToUnicode } from './cmap.ts'
import { baseEncodings, glyphToUnicode, standard, winAnsi } from './encodings.ts'
import { numbers } from './function.ts'
import type { Matrix } from './matrix.ts'
import { embeddedFile, readProgram, type EmbeddedFile, type GlyphPath, type Program } from './outlines/index.ts'

/** one character of a shown string, ready to be drawn and to advance the text position */
export type Glyph = {
  /** what to draw ('' for nothing we can map) */
  text: string
  /** advance in thousandths of the font size; null means "ask the canvas how wide this is" */
  width: number | null
  /** single-byte code 32: word spacing applies */
  space: boolean
  code: number
  /** Type 3 only: the glyph procedure's name */
  name?: string
}

export type Type3 = { matrix: Matrix; procs: PdfDict; resources: PdfDict | null }

export type FontKind = 'sans' | 'serif' | 'mono'

/** a glyph outline and the matrix to text space; `width` (thousandths of the em) is the font's own advance, if known */
export type GlyphShape = { path: GlyphPath; matrix: Matrix; width?: number; /** the path built once for a real canvas */ path2d?: Path2D }

export type Font = {
  family: string
  bold: boolean
  italic: boolean
  /** the family name as people write it ("Times New Roman"), or '' when the font's name says nothing usable */
  face: string
  kind: FontKind
  type3: Type3 | null
  /** the glyph's real shape from the embedded font program; null when there is none and a similar system font stands in */
  shape?(g: Glyph): GlyphShape | null
  /** a standard font the file doesn't embed: drawn with a bundled look-alike when the platform has one */
  standard?: { kind: FontKind; bold: boolean; italic: boolean }
  decode(bytes: Uint8Array): Glyph[]
  /** reasons the text can only be approximate */
  notes: string[]
}

const SANS = 'Helvetica, Arial, "Liberation Sans", "Helvetica Neue", sans-serif'
const SERIF = '"Times New Roman", Times, "Liberation Serif", Georgia, serif'
const MONO = '"Courier New", Courier, "Liberation Mono", Menlo, monospace'

const nameOf = (doc: PdfDocument, o: PdfObj | undefined) => {
  const v = doc.resolve(o)
  return v instanceof PdfName ? v.value : undefined
}

/**
 * Family names the document's own font might be installed under: "TimesNewRomanPS-BoldMT" gives
 * ["TimesNewRoman", "Times New Roman"]. Putting these first means a font the viewer has installed is used as is.
 */
export function nameCandidates(baseFont: string): string[] {
  const name = baseFont.replace(/^[A-Z]{6}\+/, '').replace(/,.*$/, '')
  const stem = name.split('-')[0].replace(/(PS)?MT$|PS$/, '')
  if (!/^[A-Za-z][A-Za-z0-9 ]*$/.test(stem)) return []
  return [...new Set([stem, stem.replace(/([a-z])([A-Z])/g, '$1 $2')])]
}

/** family, weight and slant from the font's name and descriptor (subset prefixes like ABCDEF+ are ignored) */
export function classify(baseFont: string, flags: number, weight?: number, italicAngle?: number) {
  const name = baseFont.replace(/^[A-Z]{6}\+/, '')
  const lower = name.toLowerCase()
  const bold = /bold|black|heavy|semibold|demi/.test(lower) || (weight ?? 0) >= 700 || (flags & 0x40000) !== 0
  const italic = /italic|oblique|slanted/.test(lower) || (flags & 0x40) !== 0 || (italicAngle ?? 0) !== 0
  const mono = /courier|mono|consolas|menlo|monaco|typewriter|lucida console|inconsolata|source code|fira code|andale|dejavu sans mono/.test(lower.replace(/[-_ ]/g, ' ')) || (flags & 1) !== 0
  const serif = /times|georgia|garamond|palatino|bookman|century|minion|serif(?!.*sans)|cambria|roman/.test(lower) && !/sans/.test(lower)
  const sans = /arial|helvetica|verdana|tahoma|calibri|sans|gothic|segoe|roboto|open/.test(lower)
  const generic = mono ? MONO : serif ? SERIF : sans ? SANS : (flags & 2) !== 0 ? SERIF : SANS
  const family = [...nameCandidates(baseFont).map((n) => `"${n}"`), generic].join(', ')
  const kind: FontKind = mono ? 'mono' : serif || (!sans && (flags & 2) !== 0) ? 'serif' : 'sans'
  const cands = nameCandidates(baseFont)
  return { family, bold, italic, face: cands[1] ?? cands[0] ?? '', kind }
}

/** the open fonts Ream (and others) put in for Office fonts, and the fonts they stand in for */
const STAND_INS: Record<string, string> = {
  Carlito: 'Calibri', Caladea: 'Cambria', Arimo: 'Arial', Tinos: 'Times New Roman', Cousine: 'Courier New',
  'Liberation Sans': 'Arial', 'Liberation Serif': 'Times New Roman', 'Liberation Mono': 'Courier New',
}

/**
 * The family name the text was set in, as Office names fonts: the family a Ream PDF says the document asked for
 * (/ReamFamily), else the embedded font's own family name, else the name read from BaseFont; an open stand-in for an
 * Office font gives that Office font's name.
 */
function faceOf(doc: PdfDocument, dict: PdfDict, file: EmbeddedFile | null, fromName: string): string {
  const asked = doc.resolve(dict.get('ReamFamily'))
  if (asked instanceof PdfString) return decodeTextString(asked.bytes)
  let face = fromName
  if (file?.kind === 'sfnt') {
    try {
      face = fontFamilyName(file.bytes) ?? face
    } catch {
      // a damaged font program keeps the name from BaseFont
    }
  }
  const base = face.replace(/ (Regular|Bold|Italic|Bold Italic)$/, '')
  return STAND_INS[base] ?? face
}

/** the standard 14 names (and Windows' names for them): fonts a reader is expected to have without embedding */
const STANDARD = /^(Helvetica|Arial|Times|Courier|Symbol|ZapfDingbats)/i

type SimpleEncoding = { symbolic: boolean; named: boolean; differences: Map<number, string>; base: string[] }

/**
 * Which glyph of the embedded program a single-byte code draws (PDF 9.6.5): a TrueType font goes through its cmap
 * subtables, by Unicode from the glyph name when it can, else the Microsoft symbol (3,0) or Mac (1,0) tables by code;
 * a Type 1 or CFF font by glyph name, else its own built-in encoding.
 */
function simpleShapes(program: Program, enc: SimpleEncoding): (g: Glyph) => GlyphShape | null {
  const gidOf = (code: number): number | undefined => {
    const name = enc.differences.get(code)
    const text = (name !== undefined ? glyphToUnicode(name) : undefined) ?? enc.base[code] ?? ''
    if ('cmap' in program) {
      const uni = program.cmap(3, 1)
      const sym = program.cmap(3, 0)
      const mac = program.cmap(1, 0)
      let g = 0
      if (uni && text && !(enc.symbolic && sym && name === undefined && !enc.named)) g = uni(text.codePointAt(0)!)
      if (!g && sym) for (const k of [code, 0xf000 + code, 0xf100 + code, 0xf200 + code]) if ((g = sym(k))) break
      if (!g && mac) g = mac(code)
      // no cmap at all: codes are glyph numbers
      if (!g && !uni && !sym && !mac) g = code
      return g || undefined
    }
    if (name !== undefined) return program.byName(name) ?? (text ? program.byUnicode(text) : undefined)
    if (enc.named && !enc.symbolic && text) return program.byUnicode(text) ?? program.builtin?.(code)
    return program.builtin?.(code) ?? (text ? program.byUnicode(text) : undefined)
  }
  return shapesBy(program, gidOf)
}

/** a CIDFontType2 maps CIDs to glyphs with CIDToGIDMap; a CID-keyed CFF font with its charset */
async function cidShapes(doc: PdfDocument, program: Program, cidDict: PdfDict): Promise<(g: Glyph) => GlyphShape | null> {
  if ('byCid' in program) return shapesBy(program, (cid) => program.byCid(cid))
  const map = doc.resolve(cidDict.get('CIDToGIDMap'))
  if (map instanceof PdfStream) {
    const bytes = await decodeStream(map).catch(() => new Uint8Array(0))
    return shapesBy(program, (cid) => (cid * 2 + 1 < bytes.length ? (bytes[cid * 2] << 8) | bytes[cid * 2 + 1] : undefined))
  }
  return shapesBy(program, (cid) => cid)
}

function shapesBy(program: Program, gidOf: (code: number) => number | undefined): (g: Glyph) => GlyphShape | null {
  const seen = new Map<number, GlyphShape | null>()
  return (g) => {
    let shape = seen.get(g.code)
    if (shape === undefined) {
      const gid = gidOf(g.code)
      // glyph 0 is the font's "missing" box: a similar system font does better
      const path = gid ? program.glyph(gid) : null
      shape = path ? { path, matrix: program.matrix, width: 'advance' in program ? program.advance(gid!) : undefined } : null
      seen.set(g.code, shape)
    }
    return shape
  }
}

const cache = new WeakMap<object, Promise<Font>>()

/** used when a text operator names a font the page doesn't have */
export const fallbackFont: Font = {
  ...classify('', 0),
  type3: null,
  notes: ['A font is missing; a default one is used'],
  decode: (bytes) => Array.from(bytes, (c) => ({ text: winAnsi[c] ?? '', width: null, space: c === 32, code: c })),
}

export async function loadFont(doc: PdfDocument, obj: PdfObj | undefined): Promise<Font> {
  const dict = doc.resolve(obj)
  if (!isDict(dict)) return fallbackFont
  let hit = cache.get(dict)
  if (!hit) cache.set(dict, (hit = build(doc, dict)))
  return hit
}

async function toUnicodeOf(doc: PdfDocument, dict: PdfDict): Promise<ToUnicode | null> {
  const s = doc.resolve(dict.get('ToUnicode'))
  if (!(s instanceof PdfStream)) return null
  try {
    return parseToUnicode(new TextDecoder('latin1').decode(await decodeStream(s)))
  } catch {
    return null
  }
}

async function build(doc: PdfDocument, dict: PdfDict): Promise<Font> {
  const subtype = nameOf(doc, dict.get('Subtype'))
  const baseFont = nameOf(doc, dict.get('BaseFont')) ?? ''
  const notes: string[] = []

  if (subtype === 'Type0') return type0(doc, dict, baseFont)

  const descObj = doc.resolve(dict.get('FontDescriptor'))
  const desc = isDict(descObj) ? descObj : null
  const num = (k: string) => {
    const v = desc && doc.resolve(desc.get(k))
    return typeof v === 'number' ? v : undefined
  }
  const embedded = !!desc && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.has(k))
  const flags = num('Flags') ?? 0
  const style = classify(baseFont, flags, num('FontWeight'), num('ItalicAngle'))
  const file = subtype === 'Type3' ? null : await embeddedFile(doc, desc)
  style.face = faceOf(doc, dict, file, style.face)
  const toUni = await toUnicodeOf(doc, dict)

  // code -> text: glyph names from the encoding first (they say which shape is drawn), then ToUnicode, then the base table
  const enc = doc.resolve(dict.get('Encoding'))
  let base: string[] = embedded ? winAnsi : standard
  /** the file names a base encoding, so it, not the font program's own, says which glyph a code is */
  let named = false
  const differences = new Map<number, string>()
  if (enc instanceof PdfName && baseEncodings[enc.value]) { base = baseEncodings[enc.value]; named = true }
  else if (isDict(enc)) {
    const b = nameOf(doc, enc.get('BaseEncoding'))
    if (b && baseEncodings[b]) { base = baseEncodings[b]; named = true }
    const diff = doc.resolve(enc.get('Differences'))
    if (Array.isArray(diff)) {
      let code = 0
      for (const item of diff) {
        const v = doc.resolve(item)
        if (typeof v === 'number') code = v
        else if (v instanceof PdfName) differences.set(code++, v.value)
      }
    }
  }
  const textOf = (c: number): string => {
    const name = differences.get(c)
    const fromName = name === undefined ? undefined : glyphToUnicode(name)
    if (fromName !== undefined) return fromName
    return toUni?.get(c) ?? base[c] ?? ''
  }

  // widths
  const first = doc.resolve(dict.get('FirstChar'))
  const widths = numbers(doc, dict.get('Widths'))
  const missing = num('MissingWidth')

  if (subtype === 'Type3') {
    const fm = (numbers(doc, dict.get('FontMatrix')) as Matrix | null) ?? [0.001, 0, 0, 0.001, 0, 0]
    const procs = doc.resolve(dict.get('CharProcs'))
    const res = doc.resolve(dict.get('Resources'))
    return {
      family: SANS, bold: false, italic: false, face: '', kind: 'sans' as const, notes,
      type3: { matrix: fm, procs: isDict(procs) ? procs : new Map(), resources: isDict(res) ? res : null },
      decode: (bytes) =>
        Array.from(bytes, (c) => ({
          text: '',
          code: c,
          space: c === 32,
          name: differences.get(c),
          width: widths && typeof first === 'number' && widths[c - first] !== undefined ? widths[c - first] * fm[0] * 1000 : 0,
        })),
    }
  }

  const program = file ? readProgram(file) : null
  const bare = baseFont.replace(/^[A-Z]{6}\+/, '')
  if (!program) {
    if (/symbol|dingbats/i.test(baseFont)) notes.push('Symbol fonts are only approximated')
    if (embedded || !STANDARD.test(bare)) notes.push('Fonts are shown with similar ones')
  }
  const shape = program ? simpleShapes(program, { symbolic: (flags & 4) !== 0, named, differences, base }) : undefined
  return {
    ...style, type3: null, notes, shape,
    standard: !embedded && STANDARD.test(bare) && !/symbol|dingbats|narrow|condensed|compressed/i.test(bare) ? { kind: style.kind, bold: style.bold, italic: style.italic } : undefined,
    decode: (bytes) =>
      Array.from(bytes, (c) => {
        const w = widths && typeof first === 'number' ? widths[c - first] : undefined
        return { text: textOf(c), code: c, space: c === 32, width: w ?? missing ?? null }
      }),
  }
}

// ---------- composite (CID) fonts ----------

async function type0(doc: PdfDocument, dict: PdfDict, baseFont: string): Promise<Font> {
  const descendants = doc.resolve(dict.get('DescendantFonts'))
  const cid = Array.isArray(descendants) ? doc.resolve(descendants[0]) : null
  const cidDict = isDict(cid) ? cid : new Map<string, PdfObj>()
  const descObj = doc.resolve(cidDict.get('FontDescriptor'))
  const desc = isDict(descObj) ? descObj : null
  const num = (k: string) => {
    const v = desc && doc.resolve(desc.get(k))
    return typeof v === 'number' ? v : undefined
  }
  const style = classify(baseFont || nameOf(doc, cidDict.get('BaseFont')) || '', num('Flags') ?? 0, num('FontWeight'), num('ItalicAngle'))
  const file = await embeddedFile(doc, desc)
  style.face = faceOf(doc, dict, file, style.face)
  const toUni = await toUnicodeOf(doc, dict)

  // /W: either  c [w1 w2 ...]  or  cFirst cLast w
  const dw = doc.resolve(cidDict.get('DW'))
  const defaultWidth = typeof dw === 'number' ? dw : 1000
  const widthMap = new Map<number, number>()
  const ranges: { lo: number; hi: number; w: number }[] = []
  const w = doc.resolve(cidDict.get('W'))
  if (Array.isArray(w)) {
    for (let i = 0; i < w.length; ) {
      const a = doc.resolve(w[i])
      const b = doc.resolve(w[i + 1])
      if (typeof a === 'number' && Array.isArray(b)) {
        b.forEach((x, k) => {
          const v = doc.resolve(x)
          if (typeof v === 'number') widthMap.set(a + k, v)
        })
        i += 2
      } else if (typeof a === 'number' && typeof b === 'number') {
        const c = doc.resolve(w[i + 2])
        if (typeof c === 'number') ranges.push({ lo: a, hi: b, w: c })
        i += 3
      } else i++
    }
  }
  const widthOf = (cidCode: number) => widthMap.get(cidCode) ?? ranges.find((r) => cidCode >= r.lo && cidCode <= r.hi)?.w ?? defaultWidth

  const lengths = toUni?.codeLengths.length ? toUni.codeLengths : [2]
  // codes are CIDs only under the Identity CMaps; ponytail: other CMaps (embedded or predefined) keep the system font
  const encoding = nameOf(doc, dict.get('Encoding'))
  const program = file && (encoding === 'Identity-H' || encoding === 'Identity-V') ? readProgram(file) : null
  const notes = program ? [] : ['Fonts are shown with similar ones']
  let unmapped = !!program // drawn from the font program, unmapped text is still drawn: only extraction misses it
  const shape = program ? await cidShapes(doc, program, cidDict) : undefined

  return {
    ...style, type3: null, notes, shape,
    decode(bytes) {
      const out: Glyph[] = []
      for (let i = 0; i < bytes.length; ) {
        const len = Math.min(lengths[lengths.length - 1], bytes.length - i) // codes this long (Identity: always 2)
        let code = 0
        for (let k = 0; k < len; k++) code = code * 256 + bytes[i + k]
        i += len
        const text = toUni?.get(code) ?? ''
        if (!text && !unmapped) {
          unmapped = true
          notes.push('Some text has no character mapping and is left out')
        }
        out.push({ text, code, space: len === 1 && code === 32, width: widthOf(code) })
      }
      return out
    },
  }
}
