import { UserError, type RunFn } from '@ream/core'
import { PdfEncryptedError, PdfParseError, repairPdf } from '@ream/pdf-core'
import { baseName, pdfFile } from '../pdf-common.ts'

export type RepairOptions = Record<string, never>

export const run: RunFn<RepairOptions> = async (files, _o, { progress }) => {
  const f = files[0]
  try {
    const r = await repairPdf(f.bytes)
    progress(1)
    return [pdfFile(`${baseName(f.name)}-repaired.pdf`, r.bytes)]
  } catch (e) {
    if (e instanceof PdfEncryptedError) throw e
    if (e instanceof PdfParseError) throw new UserError(`${f.name}: ${e.message} It may be too badly damaged to recover.`)
    throw e
  }
}
