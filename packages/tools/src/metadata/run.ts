import type { RunFn } from '@ream/core'
import { setMetadata, type Metadata } from '@ream/pdf-core'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'

/** only the fields that were changed: a missing key keeps the file's value, an empty string removes it */
export type MetadataOptions = { fields: Metadata }

export const run: RunFn<MetadataOptions> = async (files, { fields }) => {
  const doc = await loadPdf(files[0])
  return [pdfFile(`${baseName(files[0].name)}-edited.pdf`, setMetadata(doc, fields))]
}
