import { UserError, type RunFn } from '@ream/core'
import { flattenPdf, type FlattenOptions } from '@ream/pdf-core'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'

export type FlattenPdfOptions = FlattenOptions

export const run: RunFn<FlattenPdfOptions> = async (files, o, { progress }) => {
  if (!o.forms && !o.comments) throw new UserError('Choose what to flatten: form fields, comments, or both.')
  const { bytes, flattened } = await flattenPdf(await loadPdf(files[0]), o)
  if (!flattened) throw new UserError(`There is nothing to flatten: this PDF has no ${o.forms && o.comments ? 'filled form fields or comments' : o.forms ? 'form fields' : 'comments'} that show anything.`)
  progress(1)
  return [pdfFile(`${baseName(files[0].name)}-flattened.pdf`, bytes)]
}
