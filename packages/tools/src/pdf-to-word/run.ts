import { UserError, type FileData, type RunContext } from '@ream/core'
import { encodePng } from '@ream/image-core'
import { writeDocx, type DocSection } from '@ream/office-core'
import type { PdfStream } from '@ream/pdf-core'
import { browserPlatform, browserRaster, findTables, pageBlocks, pageChars, rasterSize, type PageRaster, type Platform } from '@ream/pdf-render'
import { extractFrom } from '../extract-images/run.ts'
import { baseName, clampInt, loadPdf, selectPages } from '../pdf-common.ts'
import { sectionOf } from './convert.ts'

export type PdfToWordOptions = {
  /** like "1-3, 5"; empty for every page */
  pages: string
  /** 'editable': text, tables and pictures as Word content. 'picture': each page as a picture, looks the same but cannot be edited. */
  mode: 'editable' | 'picture'
  /** resolution of the page pictures */
  dpi: number
}

export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** `raster` and `platform` are the app's canvas drawing by default; tests pass fakes */
export async function run(files: FileData[], o: PdfToWordOptions, { progress }: RunContext, raster: PageRaster = browserRaster, platform: Platform = browserPlatform): Promise<FileData[]> {
  const f = files[0]
  const doc = await loadPdf(f)
  const count = doc.pages().length
  const chosen = selectPages(o.pages, count)
  const pages = chosen ? [...chosen].sort((a, b) => a - b) : Array.from({ length: count }, (_, i) => i)
  const sections: DocSection[] = []
  const images = new Map<PdfStream, Promise<{ bytes: Uint8Array; type: 'png' | 'jpeg' } | null>>()
  const dpi = clampInt(o.dpi, 72, 300)

  for (const [n, p] of pages.entries()) {
    progress(n / pages.length)
    const size = doc.pageSize(doc.pages()[p])
    if (o.mode === 'picture') {
      const w = Math.max(1, Math.round((size.width / 72) * dpi))
      rasterSize(doc, p, w)
      const px = await raster(doc, p, w)
      sections.push({ width: size.width, height: size.height, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [{ kind: 'picture', bytes: await encodePng(px), type: 'png', width: size.width, height: size.height, alt: `Page ${p + 1}`, at: { x: 0, y: 0 } }] })
      continue
    }
    const chars = await pageChars(doc, p)
    const blocks = pageBlocks(chars, findTables(chars))
    // pictures are decoded one by one here: sectionOf asks for them by block
    const have = new Map<PdfStream, { bytes: Uint8Array; type: 'png' | 'jpeg' } | null>()
    for (const b of blocks.blocks) {
      if (b.kind !== 'picture' || have.has(b.image)) continue
      let got = images.get(b.image)
      if (!got) images.set(b.image, (got = extractFrom(doc, b.image, platform).then((r) => (r === 'unsupported' ? null : { bytes: r.bytes, type: r.ext === 'jpg' ? ('jpeg' as const) : ('png' as const) }))))
      have.set(b.image, await got)
    }
    sections.push(sectionOf(blocks, (b) => have.get(b.image) ?? null))
  }
  progress(0.95)
  if (o.mode === 'editable' && !sections.some((s) => s.blocks.length)) {
    throw new UserError('No text or pictures were found to put in the document. If these pages are scans, choose "Page pictures" instead: reading text out of pictures needs OCR, which Ream does not have yet.')
  }
  const bytes = await writeDocx({ sections, title: baseName(f.name) })
  progress(1)
  return [{ name: `${baseName(f.name)}.docx`, type: DOCX, bytes }]
}
