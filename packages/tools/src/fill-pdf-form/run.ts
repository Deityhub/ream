import { UserError, type RunFn } from '@ream/core'
import { PdfDocument, fillForm, flattenPdf, readForm } from '@ream/pdf-core'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'
import { unwritable, type FillFormOptions } from './values.ts'

export type { FillFormOptions }

export const run: RunFn<FillFormOptions> = async (files, o, { progress }) => {
  const doc = await loadPdf(files[0])
  const { fields, xfa } = readForm(doc)
  if (!fields.length) throw new UserError(xfa ? "This is an XFA form, which Ream can't fill in. Open it in Adobe Acrobat or Reader." : 'This PDF has no form fields to fill in.')
  for (const [name, v] of Object.entries(o.values)) {
    const bad = typeof v === 'string' ? unwritable(v) : []
    if (bad.length) throw new UserError(`The field "${name}" can't show ${bad.join(' ')}: PDF forms written by Ream take Western European letters only.`)
  }
  progress(0.2)
  let bytes = await fillForm(doc, o.values)
  // locked: the fields become part of the pages (comments stay as they are)
  if (o.lock) bytes = (await flattenPdf(await PdfDocument.load(bytes), { forms: true, comments: false })).bytes
  progress(1)
  return [pdfFile(`${baseName(files[0].name)}-filled.pdf`, bytes)]
}
