import { UserError, type FileData, type RunContext } from '@ream/core'
import { readDocx } from '@ream/office-core'
import { PdfDrawing, buildPdf, type ImageInput } from '@ream/pdf-core'
import { FontBook, type FontSource, type InstalledFont } from '../fonts/book.ts'
import { browserFonts } from '../fonts/source.ts'
import { baseName } from '../names.ts'
import { imageInput } from '../office-images.ts'
import { pdfFile } from '../pdf-common.ts'
import { fontNeeds, layoutDocx, picturesOf } from './layout.ts'

export type WordToPdfOptions = {
  /** fonts the panel found for the document: installed, added from files or downloaded (empty: bundled look-alikes) */
  localFonts: InstalledFont[]
}

// what an old Word file (.doc) and a password protected .docx both start with: an OLE container, not a zip
const isOle = (b: Uint8Array) => b.length > 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((v, i) => b[i] === v)

/** the PDF of a .docx. `fonts` loads the bundled look-alike fonts (the app's bundle by default; tests read them from disk) */
export async function docxToPdf(bytes: Uint8Array, localFonts: InstalledFont[] = [], fonts: FontSource = browserFonts, title = ''): Promise<Uint8Array> {
  if (isOle(bytes)) throw new UserError('This is an older Word file (.doc) or one with a password. Ream reads .docx: in Word, remove the password or choose Save As, Word Document (.docx), then try again.')
  const doc = await readDocx(bytes)
  // the fonts the file carries come after the ones the user chose, which win a tie (a font that can't be embedded is skipped by the book)
  const carried: InstalledFont[] = (doc.fonts ?? []).map((f) => ({ family: f.name, style: f.bold && f.italic ? 'Bold Italic' : f.bold ? 'Bold' : f.italic ? 'Italic' : 'Regular', postscript: '', bytes: f.bytes, source: 'file' }))
  const book = new FontBook(fonts, [...localFonts, ...carried])
  await book.load(fontNeeds(doc))
  // pictures decoded once each, before the layout (which is synchronous)
  const decoded = new Map<Uint8Array, ImageInput | null>()
  for (const b of picturesOf(doc)) if (!decoded.has(b.bytes)) decoded.set(b.bytes, await imageInput(b.bytes, b.type))
  const d = new PdfDrawing()
  d.title = title
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

export async function run(files: FileData[], o: WordToPdfOptions, { progress }: RunContext, fonts: FontSource = browserFonts): Promise<FileData[]> {
  const f = files[0]
  progress(0.05)
  let bytes: Uint8Array
  try {
    bytes = await docxToPdf(f.bytes, o.localFonts ?? [], fonts, baseName(f.name))
  } catch (e) {
    throw e instanceof UserError ? new UserError(`${f.name}: ${e.message}`) : e
  }
  progress(1)
  return [pdfFile(`${baseName(f.name)}.pdf`, bytes)]
}
