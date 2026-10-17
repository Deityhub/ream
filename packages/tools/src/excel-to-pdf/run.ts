import { UserError, type RunFn } from '@ream/core'
import { readXlsx } from '@ream/office-core'
import { PdfDrawing, buildPdf, prepareFont } from '@ream/pdf-core'
import { PAGE_SIZES, type PageSizeKey } from '../images-to-pdf/sizes.ts'
import { baseName } from '../names.ts'
import { pdfFile } from '../pdf-common.ts'
import { allText, layoutSheet } from './layout.ts'

export type ExcelToPdfOptions = {
  paper: PageSizeKey
  orientation: 'auto' | 'portrait' | 'landscape'
  fit: 'width' | 'none'
  gridlines: boolean
  /** a .ttf for text the standard fonts cannot show (other scripts); every cell then uses it */
  fontFile: Uint8Array | null
  fontName: string
}

const MARGIN = 36

export const run: RunFn<ExcelToPdfOptions> = async (files, o, { progress }) => {
  const f = files[0]
  let book
  try {
    book = await readXlsx(f.bytes)
  } catch (e) {
    throw e instanceof UserError ? new UserError(`${f.name}: ${e.message}`) : e
  }
  const sheets = book.sheets.filter((s) => !s.hidden)
  const emb = o.fontFile ? await prepareFont(o.fontFile, allText(sheets)) : null
  const d = new PdfDrawing()
  d.title = baseName(f.name)
  const layout = { page: [...(PAGE_SIZES[o.paper] ?? PAGE_SIZES.a4).size] as [number, number], orientation: o.orientation, fit: o.fit, gridlines: o.gridlines, margin: MARGIN }
  for (const [i, sheet] of sheets.entries()) {
    progress(i / sheets.length)
    layoutSheet(d, sheet, layout, emb)
  }
  if (!d.pages.length) throw new UserError('This workbook has nothing to print: its sheets are empty or hidden.')
  progress(0.95)
  const { bytes } = await buildPdf(d, emb)
  progress(1)
  return [pdfFile(`${baseName(f.name)}.pdf`, bytes)]
}
