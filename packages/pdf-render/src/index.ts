import { type Page, type PdfDocument, decodeStream, isDict, PdfStream } from '@ream/pdf-core'
import { Interpreter, type HideBox } from './interpreter.ts'
import { IDENTITY } from './matrix.ts'
import { pageBase } from './geometry.ts'
import { browserPlatform, type Ctx2D, type Platform } from './platform.ts'

export type { Ctx2D, Platform } from './platform.ts'
export { browserPlatform } from './platform.ts'
export { browserRaster, isBlank, rasterSize, type PageRaster, type Pixels } from './raster.ts'
export { Interpreter } from './interpreter.ts'
export type { HideBox }
export { rasterizeImage, type Raster } from './image.ts'
export { extractText, type ExtractOptions } from './extract.ts'
export { pageChars, type TextChar, type PageChars, type PagePicture } from './textchars.ts'
export { placedBlocks } from './placed.ts'
export { displayedArea, redactPdf, type RedactOptions } from './redact.ts'
export { documentFonts, editContent, fontLetters, pageContentItems, pageContentShares, type LineChange, type PageContentEdits, type PageLine, type PagePictureItem, type ShownBox } from './content-edit.ts'
export { pageBlocks, type PageBlocks, type Block, type TextBlock, type TableBlock, type PictureBlock, type BlockRun } from './blocks.ts'
export { findTables, type Table, type TableCell } from './tables.ts'
export type { Shapes, Rule, FillBox } from './shapes.ts'
export { layoutPage, cleanText, type LayoutOptions } from './textlayout.ts'
export { analyzePage, imagePlacements, removeOutside, BoundsCtx, type Box, type PaintedOp, type Removal, type Placement } from './bounds.ts'

export type PageGeometry = { page: Page; width: number; height: number; scale: number }

/** pixel size of a page rendered `widthPx` wide (height follows the page's proportions) */
export function pageGeometry(doc: PdfDocument, index: number, widthPx: number): PageGeometry {
  const page = doc.pages()[index]
  if (!page) throw new RangeError(`There is no page ${index + 1}`)
  const size = doc.pageSize(page)
  const scale = widthPx / (size.width || 1)
  return { page, width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), scale }
}

/** `text: false` leaves the page's text out: the design of a page under editable text; `fields: false` leaves form fields out (an editor draws its own) */
export type RenderOptions = {
  platform?: Platform
  signal?: AbortSignal
  text?: boolean
  fields?: boolean
  /** what an editor changed, left out (see `Interpreter.hide`), and areas erased: nothing is drawn inside them. Fractions of the page as displayed. */
  hide?: { text?: HideBox[]; pictures?: HideBox[]; erase?: HideBox[] }
}
export type RenderResult = { warnings: string[] }

/**
 * Draw page `index` onto `ctx`, which must belong to a canvas of the size `pageGeometry` returned for `widthPx`.
 * Never throws for a page it can only partly draw: what couldn't be drawn is reported in `warnings`.
 */
export async function renderPage(doc: PdfDocument, index: number, ctx: Ctx2D, widthPx: number, options: RenderOptions = {}): Promise<RenderResult> {
  const { page, width, height, scale } = pageGeometry(doc, index, widthPx)
  const base = pageBase(doc, page, scale)
  const interp = new Interpreter(doc, ctx, options.platform ?? browserPlatform, base, options.signal)
  interp.skipText = options.text === false
  const hide = options.hide
  if (hide?.text?.length || hide?.pictures?.length) interp.hide = { text: hide.text ?? [], pictures: hide.pictures ?? [], width, height }

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  interp.reset(IDENTITY)
  // an erased area draws nothing, whatever is under it: the page less these boxes (an even-odd clip)
  if (hide?.erase?.length) {
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    for (const b of hide.erase) ctx.rect(b.x * width, b.y * height, b.w * width, b.h * height)
    ctx.clip('evenodd')
    ctx.beginPath()
  }

  try {
    const contents = [doc.resolve(page.dict.get('Contents'))].flat().map((c) => doc.resolve(c))
    const parts: Uint8Array[] = []
    for (const c of contents) if (c instanceof PdfStream) parts.push(await decodeStream(c).catch(() => new Uint8Array(0)))
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0))
    parts.reduce((at, p) => (joined.set(p, at), joined[at + p.length] = 10, at + p.length + 1), 0)
    const res = doc.resolve(page.dict.get('Resources') ?? page.inherited.get('Resources'))
    await interp.run(joined, isDict(res) ? res : new Map())
    await interp.annotations(page, options.fields !== false)
  } finally {
    ctx.restore()
  }
  return { warnings: [...interp.warnings] }
}
