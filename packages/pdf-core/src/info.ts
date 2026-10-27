// The document information dictionary (/Info): Title, Author and friends.
import { PdfString, isDict, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'
import { ascii } from './bytes.ts'

/** the keys the metadata tool edits; any other string entries (dates, custom keys) are carried over untouched */
export const INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'] as const

/** PDF text string -> JavaScript string (UTF-16BE or UTF-8 with a byte order mark, otherwise PDFDocEncoding ~ Latin-1) */
export function decodeTextString(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3))
  return String.fromCharCode(...bytes)
}

/** JavaScript string -> PDF text string: plain bytes when every character is ASCII, UTF-16BE with a BOM otherwise */
export function encodeTextString(s: string): PdfString {
  if (/^[\x20-\x7e]*$/.test(s)) return new PdfString(ascii(s))
  const out = new Uint8Array(2 + s.length * 2)
  out[0] = 0xfe
  out[1] = 0xff
  for (let i = 0; i < s.length; i++) {
    out[2 + i * 2] = s.charCodeAt(i) >> 8
    out[3 + i * 2] = s.charCodeAt(i) & 255
  }
  return new PdfString(out, true)
}

/** every string entry of the document's /Info as text (empty when the file has none) */
export function readInfo(doc: PdfDocument): Record<string, string> {
  const info = doc.resolve(doc.trailer.get('Info'))
  const out: Record<string, string> = {}
  if (!isDict(info)) return out
  for (const [k, v] of info) {
    const s = doc.resolve(v as PdfObj)
    if (s instanceof PdfString) out[k] = decodeTextString(s.bytes)
  }
  return out
}

/** "D:20261014101500Z" for a date, the way PDF writes them (UTC) */
export const pdfDate = (d = new Date()) => 'D:' + d.toISOString().replace(/[-:T]|\.\d+/g, '').slice(0, 14) + 'Z'
