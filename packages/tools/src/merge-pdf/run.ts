import { UserError, type RunFn } from '@ream/core'
import { merge } from '@ream/pdf-core'
import { loadPdf, pdfFile } from '../pdf-common.ts'

export const run: RunFn = async (files, _options, { progress }) => {
  if (files.length < 2) throw new UserError('Add at least two PDFs to merge.')
  const inputs = []
  for (const [i, f] of files.entries()) {
    inputs.push({ doc: await loadPdf(f) })
    progress((i + 1) / (files.length + 1))
  }
  const bytes = merge(inputs)
  progress(1)
  return [pdfFile('merged.pdf', bytes)]
}
