// Letter widths of the standard fonts (Helvetica, Times, Courier), for text in a font the file doesn't embed and gives no
// widths for: without them every analysis (text boxes, redaction, editing) would have to guess, and a guess puts letters
// in the wrong places. Thousandths of an em, ASCII 32..126; the Times tables are read from Times' metrics (Tinos has them).
import { textWidth } from '@ream/pdf-core'
import type { FontKind } from './font.ts'

// prettier-ignore
const TIMES = [250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541]
// prettier-ignore
const TIMES_BOLD = [250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520]
// prettier-ignore
const TIMES_ITALIC = [250,333,420,500,500,833,778,214,333,333,500,675,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,675,675,675,500,920,611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,611,722,611,500,556,722,611,833,611,556,556,389,278,389,422,500,333,500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,500,500,389,389,278,500,444,667,444,444,389,400,275,400,541]
// prettier-ignore
const TIMES_BOLD_ITALIC = [250,389,555,500,500,833,778,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,832,667,667,667,722,667,667,722,778,389,500,667,611,889,722,722,611,722,667,556,611,722,667,889,667,611,611,333,278,333,570,500,333,500,500,444,500,444,333,500,556,278,278,500,278,778,556,500,500,500,389,389,278,556,444,667,500,444,389,348,220,348,570]

/**
 * The width of one letter in the standard font a font of this kind stands for, or null for nothing (a letter the font
 * doesn't map). Helvetica-Oblique has Helvetica's widths and Courier is 600 throughout; the four Times styles have their
 * own. Non-ASCII letters are as wide as their base letter (Times: as Helvetica's).
 */
export function standardWidth(text: string, kind: FontKind, bold: boolean, italic = false): number | null {
  if (!text) return null
  if (kind === 'mono') return 600
  if (kind === 'sans') return textWidth(text, 1000, { bold })
  const table = bold ? (italic ? TIMES_BOLD_ITALIC : TIMES_BOLD) : italic ? TIMES_ITALIC : TIMES
  const c = text.normalize('NFD').codePointAt(0)!
  return c >= 32 && c < 127 ? table[c - 32] : textWidth(text, 1000, { bold })
}
