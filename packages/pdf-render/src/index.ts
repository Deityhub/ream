import { type Page, type PdfDocument, decodeStream, isDict, PdfStream } from '@ream/pdf-core'
import { Interpreter } from './interpreter.ts'
import { IDENTITY, pageMatrix } from './matrix.ts'
import { browserPlatform, type Ctx2D, type Platform } from './platform.ts'
import { numbers } from './function.ts'

export type { Ctx2D, Platform } from './platform.ts'
export { browserPlatform } from './platform.ts'
export { Interpreter } from './interpreter.ts'
export { rasterizeImage, type Raster } from './image.ts'

export type PageGeometry = { page: Page; width: number; height: number; scale: number }

/** pixel size of a page rendered `widthPx` wide (height follows the page's proportions) */
export function pageGeometry(doc: PdfDocument, index: number, widthPx: number): PageGeometry {
  const page = doc.pages()[index]
  if (!page) throw new RangeError(`There is no page ${index + 1}`)
  const size = doc.pageSize(page)
  const scale = widthPx / (size.width || 1)
  return { page, width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), scale }
}

export type RenderOptions = { platform?: Platform; signal?: AbortSignal }
export type RenderResult = { warnings: string[] }

/** the page's visible box [llx, lly, urx, ury]: the crop box if it has one, else the media box */
function pageBox(doc: PdfDocument, page: Page): [number, number, number, number] {
  const get = (k: string) => numbers(doc, page.dict.get(k) ?? page.inherited.get(k))
  const b = [get('CropBox'), get('MediaBox')].find((x) => x && x.length === 4) ?? [0, 0, 612, 792]
  return [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])]
}

/**
 * Draw page `index` onto `ctx`, which must belong to a canvas of the size `pageGeometry` returned for `widthPx`.
 * Never throws for a page it can only partly draw: what couldn't be drawn is reported in `warnings`.
 */
export async function renderPage(doc: PdfDocument, index: number, ctx: Ctx2D, widthPx: number, options: RenderOptions = {}): Promise<RenderResult> {
  const { page, width, height, scale } = pageGeometry(doc, index, widthPx)
  const rotate = doc.resolve(page.dict.get('Rotate') ?? page.inherited.get('Rotate'))
  const base = pageMatrix(pageBox(doc, page), typeof rotate === 'number' ? rotate : 0, scale)
  const interp = new Interpreter(doc, ctx, options.platform ?? browserPlatform, base, options.signal)

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  interp.reset(IDENTITY)

  try {
    const contents = [doc.resolve(page.dict.get('Contents'))].flat().map((c) => doc.resolve(c))
    const parts: Uint8Array[] = []
    for (const c of contents) if (c instanceof PdfStream) parts.push(await decodeStream(c).catch(() => new Uint8Array(0)))
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0))
    parts.reduce((at, p) => (joined.set(p, at), joined[at + p.length] = 10, at + p.length + 1), 0)
    const res = doc.resolve(page.dict.get('Resources') ?? page.inherited.get('Resources'))
    await interp.run(joined, isDict(res) ? res : new Map())
    await interp.annotations(page)
  } finally {
    ctx.restore()
  }
  return { warnings: [...interp.warnings] }
}
