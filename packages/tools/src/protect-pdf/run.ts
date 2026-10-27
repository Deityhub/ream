import { UserError, type RunFn } from '@ream/core'
import { encryptPdf } from '@ream/pdf-core'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'
import type { ProtectPdfOptions } from './options.ts'

export type { ProtectPdfOptions }

export const run: RunFn<ProtectPdfOptions> = async (files, o, { progress }) => {
  if (!o.password) throw new UserError('Enter a password.')
  if (o.password !== o.confirm) throw new UserError("The two passwords don't match.")
  if (o.ownerPassword && o.ownerPassword === o.password) throw new UserError('Use a different owner password, or leave it empty.')
  const doc = await loadPdf(files[0])
  progress(0.2)
  const bytes = await encryptPdf(doc, {
    userPassword: o.password,
    ownerPassword: o.ownerPassword,
    method: o.compatible ? 'aes128' : 'aes256',
    permissions: { print: o.allowPrint, copy: o.allowCopy, modify: o.allowModify },
  })
  progress(1)
  return [pdfFile(`${baseName(files[0].name)}-protected.pdf`, bytes)]
}
