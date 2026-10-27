import { UserError, type FileData, type RunContext } from '@ream/core'
import { encodePng } from '@ream/image-core'
import { writePptx, type Slide } from '@ream/office-core'
import { browserRaster, pageBlocks, pageChars, placedBlocks, rasterSize, isBlank, type PageRaster } from '@ream/pdf-render'
import { baseName, clampInt, loadPdf, selectPages } from '../pdf-common.ts'
import { boxOf, designSlide, fitSlide } from './convert.ts'

export type PdfToPowerpointOptions = {
  /** like "1-3, 5"; empty for every page */
  pages: string
  /** 'editable': the page's design as a picture with its text in boxes on top. 'picture': the page as one picture with its text behind it, so it can still be searched. */
  mode: 'editable' | 'picture'
  dpi: number
}

export const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** `raster` is the app's canvas drawing by default; tests pass a fake */
export async function run(files: FileData[], o: PdfToPowerpointOptions, { progress }: RunContext, raster: PageRaster = browserRaster): Promise<FileData[]> {
  const f = files[0]
  const doc = await loadPdf(f)
  const count = doc.pages().length
  const chosen = selectPages(o.pages, count)
  const pages = chosen ? [...chosen].sort((a, b) => a - b) : Array.from({ length: count }, (_, i) => i)
  const slides: Slide[] = []
  const dpi = clampInt(o.dpi, 72, 300)
  // slides are one size: the first page's. Others keep their shapes where they were, so a page of another size is shown as it fits.
  const first = doc.pageSize(doc.pages()[pages[0]])

  for (const [n, p] of pages.entries()) {
    progress(n / pages.length)
    const size = doc.pageSize(doc.pages()[p])
    const chars = await pageChars(doc, p)
    const w = Math.max(1, Math.round((size.width / 72) * dpi))
    rasterSize(doc, p, w)
    let slide: Slide
    if (o.mode === 'picture') {
      const png = await encodePng(await raster(doc, p, w))
      // the text goes behind the picture: searchable, and there to use if the picture is deleted
      const text = pageBlocks(chars, [], { invisible: true }).blocks.flatMap((b) => (b.kind === 'text' ? [boxOf(b)] : []))
      slide = { shapes: [...text, { kind: 'pic', x: 0, y: 0, w: size.width, h: size.height, bytes: png, type: 'png', alt: `Page ${p + 1}` }] }
    } else {
      // the page drawn without its text is the design; the text goes on top in boxes that can be edited
      const px = await raster(doc, p, w, { text: false })
      slide = designSlide(placedBlocks(chars), size, isBlank(px) ? null : { bytes: await encodePng(px), type: 'png' })
    }
    slides.push(fitSlide(slide, size, first))
  }
  progress(0.95)
  if (o.mode === 'editable' && !slides.some((s) => s.shapes.length)) {
    throw new UserError('No text or pictures were found to put on the slides. If these pages are scans, choose "Page pictures" instead: reading text out of pictures needs OCR, which Ream does not have yet.')
  }
  const bytes = await writePptx({ width: first.width, height: first.height, slides, title: baseName(f.name) })
  progress(1)
  return [{ name: `${baseName(f.name)}.pptx`, type: PPTX, bytes }]
}
