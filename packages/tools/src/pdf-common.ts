import { UserError, type FileData } from '@ream/core'
import { PdfDocument, parseRanges } from '@ream/pdf-core'

export { baseName } from './names.ts'

/** load a PDF, prefixing user-facing errors with the file name so multi-file runs say which one failed */
export async function loadPdf(f: FileData): Promise<PdfDocument> {
  try {
    return await PdfDocument.load(f.bytes)
  } catch (e) {
    throw e instanceof UserError ? new UserError(`${f.name}: ${e.message}`) : e
  }
}

export const pdfFile = (name: string, bytes: Uint8Array): FileData => ({ name, type: 'application/pdf', bytes })

/** "1-3,5" -> those pages, 0-based; empty means every page (null) */
export const selectPages = (spec: string, count: number): Set<number> | null => (spec.trim() ? new Set(parseRanges(spec, count).flat()) : null)

/** "#1d4ed8" or "#fff" -> "0.11 0.31 0.85" for a PDF colour operator */
export function rgb(hex: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new UserError(`"${hex}" isn't a colour. Use a hex value like #888888.`)
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => +(parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ')
}

/** where a stamp sits on the page: row (t, m, b) and column (l, c, r) */
export type Spot = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'

/** the point a box of the given size should be centred on to sit at `spot`, `margin` points from the edges */
export function spotCentre(spot: Spot, page: { width: number; height: number }, box: { width: number; height: number }, margin: number): [number, number] {
  const x = spot[1] === 'l' ? margin + box.width / 2 : spot[1] === 'r' ? page.width - margin - box.width / 2 : page.width / 2
  const y = spot[0] === 't' ? page.height - margin - box.height / 2 : spot[0] === 'b' ? margin + box.height / 2 : page.height / 2
  return [x, y]
}

/** a whole number from the options, kept inside [min, max] */
export const clampInt = (v: unknown, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v)) || min))
