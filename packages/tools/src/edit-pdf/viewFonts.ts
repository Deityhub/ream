// The fonts of text items, for the editor: the same files the saved PDF embeds, loaded into the browser, so text on
// screen has the saved file's letters, and line breaks are worked out with the same widths (kerning off, as in the file).
import { browserFonts } from '../fonts/source.ts'
import type { InstalledFont } from '../fonts/book.ts'
import { weightOf } from '../fonts/match.ts'
import { FONTS } from './items.ts'

// the parts each bundled font comes in, with the letters each has (as Fontsource splits them)
const SUBSETS: [string, string][] = [
  ['latin', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'],
  ['latin-ext', 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'],
  ['cyrillic', 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116'],
  ['greek', 'U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF'],
]

const loading = new Map<string, Promise<void>>()

/** the CSS family a text item is shown in, once its font is ready (falls back to the system's sans while loading) */
export function cssFamily(font: string): string {
  return `"ream-edit-${font.replace(/[^\w-]/g, '_')}"`
}

/** load one style of a font into the page: a bundled one from its files, an added one from its bytes */
export function loadFont(font: string, bold: boolean, italic: boolean, added: InstalledFont[]): Promise<void> {
  const key = `${font}/${bold}/${italic}`
  let p = loading.get(key)
  if (p) return p
  const family = cssFamily(font).slice(1, -1)
  const descriptors = { weight: bold ? '700' : '400', style: italic ? 'italic' : 'normal' }
  const bundled = FONTS.find((f) => f.name === font)
  p = (async () => {
    const faces: FontFace[] = []
    if (bundled) {
      for (const [subset, range] of SUBSETS) {
        const bytes = await browserFonts(bundled.family, subset, bold ? 700 : 400, italic)
        if (bytes) faces.push(new FontFace(family, bytes as BufferSource, { ...descriptors, unicodeRange: range }))
      }
    } else {
      // an added font: the file of the nearest style, as the saved file picks it
      const mine = added.filter((f) => (f.for ?? f.family) === font)
      const slanted = mine.filter((f) => /italic|oblique/i.test(f.style) === italic)
      const pool = slanted.length ? slanted : mine
      const target = bold ? 700 : 400
      const best = pool.sort((a, b) => Math.abs(weightOf(a.style) - target) - Math.abs(weightOf(b.style) - target))[0]
      if (best) faces.push(new FontFace(family, best.bytes as BufferSource, descriptors))
    }
    for (const f of faces) {
      document.fonts.add(f)
      await f.load().catch(() => {})
    }
  })()
  loading.set(key, p)
  return p
}

let canvas: CanvasRenderingContext2D | null = null

/** a measure of text in a font at `px` pixels, for line breaking (kerning off: the file has none) */
export function measurer(font: string, bold: boolean, italic: boolean, px: number): (s: string) => number {
  canvas ??= document.createElement('canvas').getContext('2d')
  const ctx = canvas!
  ctx.font = `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${px}px ${cssFamily(font)}, sans-serif`
  ctx.fontKerning = 'none'
  return (s) => ctx.measureText(s).width
}
