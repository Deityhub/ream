// Text for stamps (watermarks, page numbers): the standard Helvetica family, which every PDF viewer has built in, so
// nothing needs embedding. Widths come from the Adobe Helvetica metrics; characters are limited to WinAnsi (Latin
// letters, digits, common symbols) until TrueType embedding arrives in M7.
import { PdfRangeError } from './errors.ts'

// advance widths in 1/1000 em for the codes 32..126
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

// the 0x80-0x9F block of WinAnsi; 0xA0-0xFF match Unicode
const WIN_HIGH = new Map<string, number>(
  Object.entries({ '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f }),
)
// widths of the non-ASCII letters that are not an accented ASCII letter, and of the common symbols (regular, bold)
const OTHER: Record<string, [number, number]> = {
  ß: [611, 611], æ: [889, 889], Æ: [1000, 1000], ø: [611, 611], Ø: [778, 778], œ: [944, 944], Œ: [1000, 1000], ð: [556, 611], Ð: [722, 722], þ: [556, 611], Þ: [667, 667],
  '×': [584, 584], '÷': [584, 584], '©': [737, 737], '®': [737, 737], '°': [400, 400], '€': [556, 556], '£': [556, 556], '¥': [556, 556], '…': [1000, 1000],
  '–': [556, 556], '—': [1000, 1000], '‘': [222, 278], '’': [222, 278], '“': [333, 500], '”': [333, 500], '•': [350, 350], '™': [1000, 1000],
}

export type StampFont = { bold?: boolean; italic?: boolean }

export const baseFont = ({ bold, italic }: StampFont) => (bold || italic ? `Helvetica-${bold ? 'Bold' : ''}${italic ? 'Oblique' : ''}` : 'Helvetica')

/** the resource name a stamp's content stream uses for this font */
export const fontResource = (font: string) => 'Ream' + font.replace('-', '')

/** WinAnsi code of one character, or undefined when Helvetica text can't show it */
function winAnsi(ch: string): number | undefined {
  const c = ch.codePointAt(0)!
  if ((c >= 32 && c < 127) || (c >= 0xa0 && c <= 0xff)) return c
  return WIN_HIGH.get(ch)
}

/** bytes of the text in WinAnsi; throws a readable error for characters Helvetica doesn't have */
export function encodeWinAnsi(text: string): number[] {
  const out: number[] = []
  for (const ch of text.normalize('NFC')) {
    const code = winAnsi(ch)
    if (code === undefined) {
      throw new PdfRangeError(`"${ch}" can't be drawn yet. Text stamps support Latin letters, digits and common symbols for now.`)
    }
    out.push(code)
  }
  return out
}

/** width of the text in points at the given size */
export function textWidth(text: string, size: number, font: StampFont = {}): number {
  const table = font.bold ? BOLD : REGULAR
  let w = 0
  for (const ch of text.normalize('NFC')) {
    const c = ch.codePointAt(0)!
    if (c >= 32 && c < 127) w += table[c - 32]
    else if (OTHER[ch]) w += OTHER[ch][font.bold ? 1 : 0]
    else {
      // an accented letter is as wide as its base letter
      const base = ch.normalize('NFD')[0].codePointAt(0)!
      w += base >= 32 && base < 127 ? table[base - 32] : 556
    }
  }
  return (w * size) / 1000
}

/** a PDF literal string "(...)" for the text, as Latin-1 characters ready to go into a content stream */
export function pdfText(text: string): string {
  let s = '('
  for (const code of encodeWinAnsi(text)) {
    if (code === 40 || code === 41 || code === 92) s += '\\' + String.fromCharCode(code)
    else if (code < 32 || code > 126) s += '\\' + code.toString(8).padStart(3, '0')
    else s += String.fromCharCode(code)
  }
  return s + ')'
}
