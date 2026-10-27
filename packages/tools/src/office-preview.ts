// A PDF of an Office file for the preview: the same converters as Excel to PDF and PowerPoint to PDF with their default
// settings and the bundled fonts, and a simple page layout for Word documents (Word to PDF is not a tool).
import type { FileData } from '@ream/core'
import { readDocx } from '@ream/office-core'
import { PdfDrawing, buildPdf, type ImageInput } from '@ream/pdf-core'
import { layoutDocx, fontNeeds } from './docx-preview/layout.ts'
import { FontBook, type FontSource } from './fonts/book.ts'
import { browserFonts } from './fonts/source.ts'
import { imageInput } from './office-images.ts'
import { run as excelToPdf } from './excel-to-pdf/run.ts'
import { run as powerpointToPdf } from './powerpoint-to-pdf/run.ts'

export type OfficeKind = 'pptx' | 'xlsx' | 'docx'

export async function docxToPdf(bytes: Uint8Array, fonts: FontSource = browserFonts): Promise<Uint8Array> {
  const doc = await readDocx(bytes)
  const book = new FontBook(fonts)
  await book.load(fontNeeds(doc))
  const decoded = new Map<Uint8Array, ImageInput | null>()
  for (const s of doc.sections) for (const b of s.blocks) if (b.kind === 'picture' && !decoded.has(b.bytes)) decoded.set(b.bytes, await imageInput(b.bytes, b.type))
  const d = new PdfDrawing()
  const ids = new Map<Uint8Array, number | null>()
  layoutDocx(d, doc, book, (p) => {
    if (!ids.has(p.bytes)) {
      const input = decoded.get(p.bytes)
      ids.set(p.bytes, input ? d.addImage(input) : null)
    }
    return ids.get(p.bytes)!
  })
  if (!d.pages.length) d.addPage(doc.sections[0]?.width ?? 595, doc.sections[0]?.height ?? 842)
  return (await buildPdf(d)).bytes
}

/** the preview PDF of an Office file */
export async function officeToPdf(file: FileData, kind: OfficeKind, fonts: FontSource = browserFonts): Promise<Uint8Array> {
  const ctx = { progress: () => {} }
  if (kind === 'docx') return docxToPdf(file.bytes, fonts)
  if (kind === 'xlsx') return (await excelToPdf([file], { setup: 'file', paper: 'a4', orientation: 'auto', fit: 'width', gridlines: false, localFonts: [] }, ctx, fonts))[0].bytes
  return (await powerpointToPdf([file], { hidden: false, localFonts: [] }, ctx, fonts))[0].bytes
}
