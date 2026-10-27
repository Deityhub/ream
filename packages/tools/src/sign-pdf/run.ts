import { UserError, type RunFn } from '@ream/core'
import { decodePng } from '@ream/image-core'
import { prepareImage, stamp } from '@ream/pdf-core'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'
import { fitInside, pagesToSign, type SignPdfOptions } from './place.ts'

export type { SignPdfOptions }

export const run: RunFn<SignPdfOptions> = async (files, o, { progress }) => {
  if (!o.image) throw new UserError('Make a signature first: draw it, type it or upload a picture.')
  const doc = await loadPdf(files[0])
  const img = await decodePng(o.image)
  const prepared = await prepareImage(img.data, img.width, img.height)
  progress(0.5)
  const pages = new Set(pagesToSign(o, doc.pages().length))
  const bytes = stamp(doc, (page) => {
    if (!pages.has(page.index)) return null
    const b = fitInside(o.rect, img.width / img.height, page)
    return { content: `q ${b.w} 0 0 ${b.h} ${b.x} ${b.y} cm /ReamSig Do Q\n`, images: { Sig: prepared } }
  })
  progress(1)
  return [pdfFile(`${baseName(files[0].name)}-signed.pdf`, bytes)]
}
