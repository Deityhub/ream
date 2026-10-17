import type { PdfDocument } from '@ream/pdf-core'
import { pageGeometry, renderPage } from './index.ts'

/** straight RGBA pixels, the same shape as image-core's ImageBuffer (this package doesn't depend on it) */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray }

/** Draw page `index` `widthPx` wide into pixels. Tools take one as a parameter so their `run` stays free of canvas types; tests pass a fake. */
export type PageRaster = (doc: PdfDocument, index: number, widthPx: number) => Promise<Pixels>

/** the pixel size a page gets at `widthPx`, so a tool can check limits before drawing */
export const rasterSize = (doc: PdfDocument, index: number, widthPx: number) => {
  const { width, height } = pageGeometry(doc, index, widthPx)
  return { width, height }
}

/** the app's rasteriser: an OffscreenCanvas (worker or page) and our renderer */
export const browserRaster: PageRaster = async (doc, index, widthPx) => {
  const { width, height } = pageGeometry(doc, index, widthPx)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  await renderPage(doc, index, ctx, widthPx)
  return { width, height, data: ctx.getImageData(0, 0, width, height).data }
}
