// Getting the characters of a page with where each one sits, by running the page through the renderer's own interpreter
// against a canvas stand-in that draws nothing. Text extraction uses the same fonts, encodings and ToUnicode maps as drawing.
import { textWidth, type PdfDocument } from '@ream/pdf-core'
import { Interpreter } from './interpreter.ts'
import { pageBase } from './geometry.ts'
import { pageContent } from './bounds.ts'
import type { Ctx2D, Platform } from './platform.ts'

/** one character as displayed (the page is y-down in points, rotation applied): where its baseline starts and ends */
export type TextChar = {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  size: number
  bold: boolean
  italic: boolean
  /** direction of the text line in degrees (0 = left to right) */
  angle: number
  /** drawn in render mode 3: there for searching and copying, not seen (scanned pages with a text layer) */
  invisible: boolean
}

export type PageChars = { chars: TextChar[]; width: number; height: number }

const NO_PLATFORM: Platform = {
  imageFromRGBA: () => ({}) as CanvasImageSource,
  decodeJpeg: () => Promise.reject(new Error('not needed: pictures are not decoded for text')),
}

/**
 * A context that draws nothing. Text widths come from a real canvas when one exists (the app's worker has
 * OffscreenCanvas), otherwise Helvetica's widths: only fonts that give no widths of their own depend on it.
 */
function textContext(): Ctx2D {
  const real = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null
  let font = '10px sans-serif'
  const noop = () => {}
  const target: Record<string, unknown> = {
    measureText: (text: string) => {
      if (real) {
        real.font = font
        return real.measureText(text)
      }
      // no canvas (tests, Node): Helvetica's own widths, close to most sans fonts
      return { width: textWidth(text, Number(/([\d.]+)px/.exec(font)?.[1] ?? 10), { bold: /\bbold\b/.test(font) }) }
    },
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  }
  return new Proxy(target, {
    get: (t, k: string) => (k === 'font' ? font : k in t ? t[k] : noop),
    set: (_t, k: string, v) => {
      if (k === 'font') font = String(v)
      return true
    },
  }) as unknown as Ctx2D
}

/** every character of page `index` (0-based) with its place, in the order the file draws them */
export async function pageChars(doc: PdfDocument, index: number): Promise<PageChars> {
  const page = doc.pages()[index]
  if (!page) throw new RangeError(`There is no page ${index + 1}`)
  const size = doc.pageSize(page)
  const interp = new Interpreter(doc, textContext(), NO_PLATFORM, pageBase(doc, page, 1))
  interp.analysis = true
  const chars: TextChar[] = []
  interp.onGlyph = (g) => {
    const dx = g.x1 - g.x0
    const dy = g.y1 - g.y0
    chars.push({
      text: g.text,
      x0: g.x0,
      y0: g.y0,
      x1: g.x1,
      y1: g.y1,
      size: g.size,
      bold: g.bold,
      italic: g.italic,
      angle: dx === 0 && dy === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI,
      invisible: g.renderMode === 3,
    })
  }
  interp.reset([1, 0, 0, 1, 0, 0])
  try {
    const { content, res } = await pageContent(doc, index)
    await interp.run(content, res)
    await interp.annotations(page)
  } catch {
    // a page that can't be read to the end gives the text found so far
  }
  return { chars, width: size.width, height: size.height }
}
