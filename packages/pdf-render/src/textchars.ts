// Getting the characters of a page with where each one sits, by running the page through the renderer's own interpreter
// against a canvas stand-in that draws nothing. Text extraction uses the same fonts, encodings and ToUnicode maps as drawing.
import { textWidth, type PdfDocument, type PdfStream } from '@ream/pdf-core'
import { Interpreter } from './interpreter.ts'
import { pageBase } from './geometry.ts'
import { mul } from './matrix.ts'
import { pageContent } from './bounds.ts'
import type { Ctx2D, Platform } from './platform.ts'
import { ShapeRecorder, type Shapes } from './shapes.ts'

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
  /** the font's name as people write it and its kind; absent on characters made without a font (tests) */
  face?: string
  kind?: 'sans' | 'serif' | 'mono'
  /** fill colour, 0..255 each */
  color?: [number, number, number]
  /** direction of the text line in degrees (0 = left to right) */
  angle: number
  /** drawn in render mode 3: there for searching and copying, not seen (scanned pages with a text layer) */
  invisible: boolean
}

/** a picture as drawn: where its box sits on the displayed page (points, y down) */
export type PagePicture = { image: PdfStream; x0: number; y0: number; x1: number; y1: number }

export type PageChars = { chars: TextChar[]; width: number; height: number; /** ruled lines and filled boxes, for table detection */ shapes: Shapes; pictures: PagePicture[] }

const NO_PLATFORM: Platform = {
  imageFromRGBA: () => ({}) as CanvasImageSource,
  decodeJpeg: () => Promise.reject(new Error('not needed: pictures are not decoded for text')),
}

/**
 * A context that draws nothing. Text widths come from a real canvas when one exists (the app's worker has
 * OffscreenCanvas), otherwise Helvetica's widths: only fonts that give no widths of their own depend on it.
 */
function textContext(rec: ShapeRecorder): Ctx2D {
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
  // paths and their colours go to the recorder (ruled lines for table detection), everything else is ignored
  const shapeCalls = ['save', 'restore', 'setTransform', 'transform', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'closePath', 'rect', 'fillRect', 'fill', 'stroke']
  const shapeProps = ['lineWidth', 'fillStyle', 'strokeStyle']
  return new Proxy(target, {
    get: (t, k: string) => {
      if (k === 'font') return font
      if (shapeCalls.includes(k)) return (rec[k as keyof ShapeRecorder] as (...a: unknown[]) => void).bind(rec)
      if (shapeProps.includes(k)) return rec[k as 'lineWidth']
      return k in t ? t[k] : noop
    },
    set: (_t, k: string, v) => {
      if (k === 'font') font = String(v)
      else if (shapeProps.includes(k)) (rec as unknown as Record<string, unknown>)[k] = v
      return true
    },
  }) as unknown as Ctx2D
}

/** every character of page `index` (0-based) with its place, in the order the file draws them */
export async function pageChars(doc: PdfDocument, index: number): Promise<PageChars> {
  const page = doc.pages()[index]
  if (!page) throw new RangeError(`There is no page ${index + 1}`)
  const size = doc.pageSize(page)
  const rec = new ShapeRecorder()
  const interp = new Interpreter(doc, textContext(rec), NO_PLATFORM, pageBase(doc, page, 1))
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
      face: g.face,
      kind: g.kind,
      color: g.color,
      angle: dx === 0 && dy === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI,
      invisible: g.renderMode === 3,
    })
  }
  const pictures: PagePicture[] = []
  const base = pageBase(doc, page, 1)
  interp.onImage = (image, ctm) => {
    // the picture fills the unit square: its corners, in displayed coordinates, give the box
    const m = mul(ctm, base)
    const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]]
    const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]]
    pictures.push({ image, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) })
  }
  interp.reset([1, 0, 0, 1, 0, 0])
  try {
    const { content, res } = await pageContent(doc, index)
    await interp.run(content, res)
    await interp.annotations(page)
  } catch {
    // a page that can't be read to the end gives the text found so far
  }
  return { chars, width: size.width, height: size.height, shapes: rec.shapes, pictures }
}
