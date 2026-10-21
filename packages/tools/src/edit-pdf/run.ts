import { UserError, type FileData, type RunContext } from '@ream/core'
import { PdfDocument, decorate, flattenPdf } from '@ream/pdf-core'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'
import { browserFonts } from '../fonts/source.ts'
import type { FontSource } from '../fonts/book.ts'
import { additions } from './draw.ts'
import type { EditPdfOptions } from './items.ts'

export type { EditPdfOptions }

/** `fonts` gives the bundled fonts (the app's; tests read them from disk) */
export async function run(files: FileData[], o: EditPdfOptions, { progress }: RunContext, fonts: FontSource = browserFonts): Promise<FileData[]> {
  if (!o.items.length) throw new UserError('Add something to a page first: text, a picture, a shape, a drawing or a comment.')
  const doc = await loadPdf(files[0])
  const pages = doc.pages().length
  if (o.items.some((i) => i.page >= pages)) throw new UserError('Some of what was added is on a page this PDF does not have. Open the file again.')
  const adds = await additions(doc, o, fonts)
  progress(0.6)
  let bytes = await decorate(doc, adds)
  if (o.flattenComments) bytes = (await flattenPdf(await PdfDocument.load(bytes), { forms: false, comments: true })).bytes
  progress(1)
  return [pdfFile(`${baseName(files[0].name)}-edited.pdf`, bytes)]
}
