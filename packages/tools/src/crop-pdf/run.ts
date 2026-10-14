import type { RunFn } from '@ream/core'
import { crop } from '@ream/pdf-core'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'

export type CropPdfOptions = {
  unit: 'mm' | 'in' | 'pt' | '%'
  top: number
  right: number
  bottom: number
  left: number
}

const PER_UNIT = { mm: 72 / 25.4, in: 72, pt: 1 } as const

export const run: RunFn<CropPdfOptions> = async (files, o, { progress }) => {
  const doc = await loadPdf(files[0])
  const amount = (v: number) => Math.max(0, Number(v) || 0)
  const bytes = crop(doc, (page) => {
    progress((page.index + 1) / page.count)
    // percentages are of the page's own width (left, right) and height (top, bottom)
    const along = (v: number, of: number) => (o.unit === '%' ? (amount(v) / 100) * of : amount(v) * PER_UNIT[o.unit])
    return [along(o.top, page.height), along(o.right, page.width), along(o.bottom, page.height), along(o.left, page.width)]
  })
  return [pdfFile(`${baseName(files[0].name)}-cropped.pdf`, bytes)]
}
