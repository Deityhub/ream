import { UserError, type FileData, type RunContext } from '@ream/core'
import { readXlsx, type Sheet } from '@ream/office-core'
import { PdfDrawing, buildPdf, type ImageInput } from '@ream/pdf-core'
import { FontBook, type FontSource, type InstalledFont } from '../fonts/book.ts'
import { browserFonts } from '../fonts/source.ts'
import { PAGE_SIZES, type PageSizeKey } from '../images-to-pdf/sizes.ts'
import { baseName } from '../names.ts'
import { imageInput } from '../office-images.ts'
import { pdfFile } from '../pdf-common.ts'
import { fontNeeds, layoutSheet, type LayoutOptions } from './layout.ts'

export type ExcelToPdfOptions = {
  /** 'file': each sheet prints as its page setup says (paper, direction, margins, fit, grid lines); 'choose': the settings below */
  setup: 'file' | 'choose'
  /** with 'file', the paper of sheets that don't name one */
  paper: PageSizeKey
  orientation: 'auto' | 'portrait' | 'landscape'
  fit: 'width' | 'none'
  gridlines: boolean
  /** fonts the panel found for the workbook: installed, added from files or downloaded (empty: bundled look-alikes) */
  localFonts: InstalledFont[]
}

const MARGIN = 36
const EDGES = { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN }

/** how one sheet is laid out: as its own page setup says, or as chosen in the panel */
function layoutFor(sheet: Sheet, o: ExcelToPdfOptions): LayoutOptions {
  const paper = [...(PAGE_SIZES[o.paper] ?? PAGE_SIZES.a4).size] as [number, number]
  const p = sheet.page
  // a sheet that saved no page settings has nothing to follow: it gets the panel's settings
  if (o.setup === 'file' && p?.saved) return { page: p.paper ?? paper, orientation: p.landscape ? 'landscape' : 'portrait', fit: p.fit ?? 'none', scale: p.scale / 100, gridlines: p.gridlines, margins: p.margins, centered: p.centered }
  return { page: paper, orientation: o.orientation, fit: o.fit, gridlines: o.gridlines, margins: EDGES }
}

/** `fonts` loads the bundled look-alike fonts (the app's bundle by default; tests read them from disk) */
export async function run(files: FileData[], o: ExcelToPdfOptions, { progress }: RunContext, fonts: FontSource = browserFonts): Promise<FileData[]> {
  const f = files[0]
  let book
  try {
    book = await readXlsx(f.bytes)
  } catch (e) {
    throw e instanceof UserError ? new UserError(`${f.name}: ${e.message}`) : e
  }
  const sheets = book.sheets.filter((s) => !s.hidden)
  const faces = new FontBook(fonts, o.localFonts ?? [])
  await faces.load(fontNeeds(sheets))
  // pictures decoded once each, before the layout (which is synchronous)
  const decoded = new Map<Uint8Array, ImageInput | null>()
  for (const sh of sheets) for (const p of sh.pictures ?? []) if (!decoded.has(p.bytes)) decoded.set(p.bytes, await imageInput(p.bytes, p.type, p.name))
  const d = new PdfDrawing()
  const ids = new Map<Uint8Array, number | null>()
  const imageId = (p: { bytes: Uint8Array }) => {
    if (!ids.has(p.bytes)) { const input = decoded.get(p.bytes); ids.set(p.bytes, input ? d.addImage(input) : null) }
    return ids.get(p.bytes)!
  }
  d.title = baseName(f.name)
  for (const [i, sheet] of sheets.entries()) {
    progress(i / sheets.length)
    layoutSheet(d, sheet, layoutFor(sheet, o), faces, imageId)
  }
  if (!d.pages.length) throw new UserError('This workbook has nothing to print: its sheets are empty or hidden.')
  progress(0.95)
  const { bytes } = await buildPdf(d)
  progress(1)
  return [pdfFile(`${baseName(f.name)}.pdf`, bytes)]
}
