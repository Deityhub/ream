import { PdfName, PdfStream, decodeStream, isDict, type PdfDict, type PdfDocument, type PdfObj } from '@ream/pdf-core'
import { parseToUnicode, type ToUnicode } from './cmap.ts'
import { baseEncodings, glyphToUnicode, standard, winAnsi } from './encodings.ts'
import { numbers } from './function.ts'
import type { Matrix } from './matrix.ts'

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

export type Font = {
  family: string
  bold: boolean
  italic: boolean
  type3: Type3 | null
  /** we can't draw the real glyph shapes, so a similar system font stands in */
  substituted: boolean
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
  return { family, bold, italic }
}

const cache = new WeakMap<object, Promise<Font>>()

/** used when a text operator names a font the page doesn't have */
export const fallbackFont: Font = {
  ...classify('', 0),
  type3: null,
  substituted: true,
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
  const style = classify(baseFont, num('Flags') ?? 0, num('FontWeight'), num('ItalicAngle'))
  const toUni = await toUnicodeOf(doc, dict)

  // code -> text: glyph names from the encoding first (they say which shape is drawn), then ToUnicode, then the base table
  const enc = doc.resolve(dict.get('Encoding'))
  let base: string[] = embedded ? winAnsi : standard
  const differences = new Map<number, string>()
  if (enc instanceof PdfName && baseEncodings[enc.value]) base = baseEncodings[enc.value]
  else if (isDict(enc)) {
    const b = nameOf(doc, enc.get('BaseEncoding'))
    if (b && baseEncodings[b]) base = baseEncodings[b]
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
      family: SANS, bold: false, italic: false, substituted: false, notes,
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

  const symbolic = /symbol|dingbats/i.test(baseFont)
  if (symbolic) notes.push('Symbol fonts are only approximated')
  if (embedded || !/^(Helvetica|Arial|Times|Courier|Symbol|ZapfDingbats)/i.test(baseFont.replace(/^[A-Z]{6}\+/, ''))) notes.push('Fonts are shown with similar ones')
  return {
    ...style, type3: null, substituted: true, notes,
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
  const notes = ['Fonts are shown with similar ones']
  let unmapped = false

  return {
    ...style, type3: null, substituted: true, notes,
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
