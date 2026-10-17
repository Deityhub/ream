import { UserError, type FileData, type RunContext } from '@ream/core'
import { encodePng } from '@ream/image-core'
import { writePptx, type Slide } from '@ream/office-core'
import type { PdfStream } from '@ream/pdf-core'
import { browserPlatform, browserRaster, findTables, pageBlocks, pageChars, rasterSize, type PageRaster, type Platform } from '@ream/pdf-render'
import { extractFrom } from '../extract-images/run.ts'
import { baseName, clampInt, loadPdf, selectPages } from '../pdf-common.ts'
import { boxOf, slideOf } from './convert.ts'

export type PdfToPowerpointOptions = {
  /** like "1-3, 5"; empty for every page */
  pages: string
  /** 'editable': text boxes, tables and pictures. 'picture': the page as a picture with its text behind it, so it can still be searched. */
  mode: 'editable' | 'picture'
  dpi: number
}

export const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** `raster` and `platform` are the app's canvas drawing by default; tests pass fakes */
export async function run(files: FileData[], o: PdfToPowerpointOptions, { progress }: RunContext, raster: PageRaster = browserRaster, platform: Platform = browserPlatform): Promise<FileData[]> {
  const f = files[0]
  const doc = await loadPdf(f)
  const count = doc.pages().length
  const chosen = selectPages(o.pages, count)
  const pages = chosen ? [...chosen].sort((a, b) => a - b) : Array.from({ length: count }, (_, i) => i)
  const slides: Slide[] = []
  const dpi = clampInt(o.dpi, 72, 300)
  const images = new Map<PdfStream, Promise<{ bytes: Uint8Array; type: 'png' | 'jpeg' } | null>>()
  // slides are one size: the first page's. Others keep their shapes where they were, so a page of another size is shown as it fits.
  const first = doc.pageSize(doc.pages()[pages[0]])

  for (const [n, p] of pages.entries()) {
    progress(n / pages.length)
    const size = doc.pageSize(doc.pages()[p])
    const chars = await pageChars(doc, p)
    if (o.mode === 'picture') {
      const w = Math.max(1, Math.round((size.width / 72) * dpi))
      rasterSize(doc, p, w)
      const png = await encodePng(await raster(doc, p, w))
      // the text goes behind the picture: searchable, and there to use if the picture is deleted
      const text = pageBlocks(chars, [], { invisible: true }).blocks.flatMap((b) => (b.kind === 'text' ? [boxOf(b)] : []))
      slides.push({ shapes: [...text, { kind: 'pic', x: 0, y: 0, w: size.width, h: size.height, bytes: png, type: 'png', alt: `Page ${p + 1}` }] })
      continue
    }
    const blocks = pageBlocks(chars, findTables(chars))
    const have = new Map<PdfStream, { bytes: Uint8Array; type: 'png' | 'jpeg' } | null>()
    for (const b of blocks.blocks) {
      if (b.kind !== 'picture' || have.has(b.image)) continue
      let got = images.get(b.image)
      if (!got) images.set(b.image, (got = extractFrom(doc, b.image, platform).then((r) => (r === 'unsupported' ? null : { bytes: r.bytes, type: r.ext === 'jpg' ? ('jpeg' as const) : ('png' as const) }))))
      have.set(b.image, await got)
    }
    slides.push(slideOf(blocks, (b) => have.get(b.image) ?? null))
  }
  progress(0.95)
  if (o.mode === 'editable' && !slides.some((s) => s.shapes.length)) {
    throw new UserError('No text or pictures were found to put on the slides. If these pages are scans, choose "Page pictures" instead: reading text out of pictures needs OCR, which Ream does not have yet.')
  }
  const bytes = await writePptx({ width: first.width, height: first.height, slides, title: baseName(f.name) })
  progress(1)
  return [{ name: `${baseName(f.name)}.pptx`, type: PPTX, bytes }]
}
