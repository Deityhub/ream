import { UserError, type FileData } from '@ream/core'
import { PdfDocument } from '@ream/pdf-core'

export { baseName } from './names.ts'

/** load a PDF, prefixing user-facing errors with the file name so multi-file runs say which one failed */
export async function loadPdf(f: FileData): Promise<PdfDocument> {
  try {
    return await PdfDocument.load(f.bytes)
  } catch (e) {
    throw e instanceof UserError ? new UserError(`${f.name}: ${e.message}`) : e
  }
}

export const pdfFile = (name: string, bytes: Uint8Array): FileData => ({ name, type: 'application/pdf', bytes })
