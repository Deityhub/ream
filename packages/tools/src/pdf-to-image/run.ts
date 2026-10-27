import { UserError, type FileData, type RunContext } from '@ream/core'
import { checkPixels, flattenOnWhite, encodePng, encodeJpeg } from '@ream/image-core'
import { browserRaster, rasterSize, type PageRaster } from '@ream/pdf-render'
import { baseName, clampInt, loadPdf, selectPages } from '../pdf-common.ts'

export type PdfToImageOptions = {
  /** like "1-3, 5"; empty for every page */
  pages: string
  format: 'png' | 'jpg'
  /** dots per inch; a PDF page is measured in 1/72 inch */
  dpi: number
  /** JPG only, 40..100 */
  quality: number
}

/** `raster` is the app's canvas drawing by default; tests pass a fake */
export async function run(files: FileData[], o: PdfToImageOptions, { progress }: RunContext, raster: PageRaster = browserRaster): Promise<FileData[]> {
  const f = files[0]
  const doc = await loadPdf(f)
  const count = doc.pages().length
  const chosen = selectPages(o.pages, count)
  const pages = chosen ? [...chosen].sort((a, b) => a - b) : Array.from({ length: count }, (_, i) => i)
  const dpi = clampInt(o.dpi, 36, 600)
  const jpg = o.format === 'jpg'
  const quality = clampInt(o.quality, 40, 100)
  const base = baseName(f.name)
  const digits = String(count).length

  // check every page's size first, so a page 40 of 40 that is too big doesn't waste the time spent on 1 to 39
  const widths = pages.map((p) => {
    const w = Math.max(1, Math.round((doc.pageSize(doc.pages()[p]).width / 72) * dpi))
    const { width, height } = rasterSize(doc, p, w)
    checkPixels(width, height, `At ${dpi} dpi page ${p + 1} would be`)
    return w
  })

  const out: FileData[] = []
  for (const [n, p] of pages.entries()) {
    progress(n / pages.length)
    const px = await raster(doc, p, widths[n])
    const bytes = jpg ? encodeJpeg(flattenOnWhite(px), { quality }) : await encodePng(px)
    out.push({ name: `${base}-page-${String(p + 1).padStart(digits, '0')}.${jpg ? 'jpg' : 'png'}`, type: jpg ? 'image/jpeg' : 'image/png', bytes })
  }
  progress(1)
  if (!out.length) throw new UserError('No pages were chosen.')
  return out
}
