import { UserError, type FileData, type RunContext } from '@ream/core'
import { PdfDocument, decorate, editForm, flattenPdf } from '@ream/pdf-core'
import { browserPlatform, editContent, type Platform } from '@ream/pdf-render'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'
import { browserFonts } from '../fonts/source.ts'
import type { FontSource } from '../fonts/book.ts'
import { additions } from './draw.ts'
import { formEdits } from './fields.ts'
import { contentEdits } from './content.ts'
import { isContent, isField, type EditPdfOptions } from './items.ts'

export type { EditPdfOptions }

/** `fonts` gives the bundled fonts (the app's; tests read them from disk); `platform` decodes pictures an erased area reaches */
export async function run(files: FileData[], o: EditPdfOptions, { progress }: RunContext, fonts: FontSource = browserFonts, platform: Platform = browserPlatform): Promise<FileData[]> {
  let doc = await loadPdf(files[0])
  const pages = doc.pages().length
  if (o.items.some((i) => i.page >= pages)) throw new UserError('Some of what was added is on a page this PDF does not have. Open the file again.')
  const sizes = doc.pages().map((p) => doc.pageSize(p))
  // the page's own content: what is changed in it, and what is drawn over it instead
  const content = contentEdits(o.items, sizes)
  const marks = [...o.items.filter((i) => !isField(i) && !isContent(i)), ...content.draw]
  // fields first: their names refer to the file as it was
  const fields = formEdits(o, sizes)
  if (!marks.length && !fields && !content.edits.size) throw new UserError('Change something first: add text, a picture, a shape, a drawing, a comment or a form field.')
  let bytes = files[0].bytes
  if (fields) {
    bytes = await editForm(doc, fields)
    doc = await PdfDocument.load(bytes)
  }
  if (content.edits.size) {
    bytes = await editContent(doc, content.edits, platform)
    doc = await PdfDocument.load(bytes)
  }
  progress(0.4)
  if (marks.length) bytes = await decorate(doc, await additions(doc, { ...o, items: marks }, fonts))
  progress(0.8)
  if (o.flattenComments) bytes = (await flattenPdf(await PdfDocument.load(bytes), { forms: false, comments: true })).bytes
  progress(1)
  return [pdfFile(`${baseName(files[0].name)}-edited.pdf`, bytes)]
}
