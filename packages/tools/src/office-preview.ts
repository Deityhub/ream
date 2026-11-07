// A PDF of an Office file for the preview: the same converters as Word to PDF, Excel to PDF and PowerPoint to PDF with
// their default settings and the bundled fonts.
import type { FileData } from '@ream/core'
import type { FontSource } from './fonts/book.ts'
import { browserFonts } from './fonts/source.ts'
import { run as excelToPdf } from './excel-to-pdf/run.ts'
import { run as powerpointToPdf } from './powerpoint-to-pdf/run.ts'
import { docxToPdf } from './word-to-pdf/run.ts'

export type OfficeKind = 'pptx' | 'xlsx' | 'docx'

/** the preview PDF of an Office file */
export async function officeToPdf(file: FileData, kind: OfficeKind, fonts: FontSource = browserFonts): Promise<Uint8Array> {
  const ctx = { progress: () => {} }
  if (kind === 'docx') return docxToPdf(file.bytes, [], fonts)
  if (kind === 'xlsx') return (await excelToPdf([file], { setup: 'file', paper: 'a4', orientation: 'auto', fit: 'width', gridlines: false, localFonts: [] }, ctx, fonts))[0].bytes
  return (await powerpointToPdf([file], { hidden: false, localFonts: [] }, ctx, fonts))[0].bytes
}
