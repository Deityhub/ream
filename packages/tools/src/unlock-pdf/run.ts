import type { RunFn } from '@ream/core'
import { decryptPdf } from '@ream/pdf-core'
import { UserError } from '@ream/core'
import { baseName, pdfFile } from '../pdf-common.ts'

/** The same PDF without its password and without its limits on printing, copying and editing. A file that was not protected comes back as it was. */
export const run: RunFn<Record<string, never>> = async (files) => {
  const f = files[0]
  try {
    // a locked file was already opened with its password when it was added, so what arrives here is plain
    return [pdfFile(`${baseName(f.name)}-unlocked.pdf`, await decryptPdf(f.bytes, ''))]
  } catch (e) {
    throw e instanceof UserError ? new UserError(`${f.name}: ${e.message}`) : e
  }
}
