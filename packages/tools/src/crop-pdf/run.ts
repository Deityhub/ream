import type { RunFn } from '@ream/core'
import { deflate } from '@ream/core'
import { crop, cropBoxes, type PageRewrite } from '@ream/pdf-core'
import { removeOutside } from '@ream/pdf-render'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'
import { NOTHING, marginsOf, pagesToCrop, rectFor, type CropPdfOptions } from './margins.ts'

export type { CropPdfOptions }

export const run: RunFn<CropPdfOptions> = async (files, o, { progress }) => {
  const doc = await loadPdf(files[0])
  if (!pagesToCrop(o, doc.pages().length).length) throw NOTHING
  const margins = (page: { index: number; width: number; height: number }) => {
    const r = rectFor(o, page.index)
    return r && marginsOf(r, page)
  }

  // deleting: rewrite each cropped page's drawing instructions without what lies entirely outside the kept area
  let rewrite: Map<number, PageRewrite> | undefined
  if (o.remove) {
    rewrite = new Map()
    const boxes = cropBoxes(doc, margins)
    let done = 0
    for (const [index, keep] of boxes) {
      const cut = await removeOutside(doc, index, keep)
      rewrite.set(index, { content: await deflate(cut.content), used: cut.used })
      progress((++done / boxes.size) * 0.9)
    }
  }
  const bytes = crop(doc, margins, { rewrite })
  progress(1)
  return [pdfFile(`${baseName(files[0].name)}-cropped.pdf`, bytes)]
}
