// Page sizes for Images to PDF. Constants only (no engine imports), so the options panel can use them too.

export const MM = 72 / 25.4 // points per millimetre

/** portrait sizes in points */
export const PAGE_SIZES = {
  a3: { label: 'A3', size: [842, 1191], group: 'ISO' },
  a4: { label: 'A4', size: [595, 842], group: 'ISO' },
  a5: { label: 'A5', size: [420, 595], group: 'ISO' },
  a6: { label: 'A6', size: [298, 420], group: 'ISO' },
  b4: { label: 'B4', size: [709, 1001], group: 'ISO' },
  b5: { label: 'B5', size: [499, 709], group: 'ISO' },
  letter: { label: 'US Letter', size: [612, 792], group: 'North American' },
  legal: { label: 'US Legal', size: [612, 1008], group: 'North American' },
  tabloid: { label: 'Tabloid', size: [792, 1224], group: 'North American' },
  executive: { label: 'Executive', size: [522, 756], group: 'North American' },
} as const satisfies Record<string, { label: string; size: [number, number]; group: string }>

export type PageSizeKey = keyof typeof PAGE_SIZES
export type PageSizeChoice = 'fit' | PageSizeKey | 'custom'

/** custom pages stay within the PDF limit of 200 inches */
export const CUSTOM_MM = { min: 20, max: 5080 }

/** the margin slider's largest value for the chosen page, in millimetres: half the short side less 10 mm */
export function maxMarginMm(o: { size: PageSizeChoice; customWidth: number; customHeight: number }): number {
  if (o.size === 'fit') return 150
  const [w, h] = o.size === 'custom' ? [clampMm(o.customWidth), clampMm(o.customHeight)] : PAGE_SIZES[o.size].size.map((p) => p / MM)
  return Math.max(0, Math.floor(Math.min(w, h) / 2 - 10))
}

export const clampMm = (v: number) => Math.min(CUSTOM_MM.max, Math.max(CUSTOM_MM.min, Number(v) || CUSTOM_MM.min))
