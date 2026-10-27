import { UserError, type FileData, type RunContext } from '@ream/core'
import { readPptx, type Slide } from '@ream/office-core'
import { PdfDrawing, buildPdf, type ImageInput } from '@ream/pdf-core'
import { imageInput } from '../office-images.ts'
import { FontBook, type FontNeed, type FontSource, type InstalledFont } from '../fonts/book.ts'
import { chartFontNeeds } from '../office-charts.ts'
import { browserFonts } from '../fonts/source.ts'
import { baseName } from '../names.ts'
import { pdfFile } from '../pdf-common.ts'
import { drawSlide } from './layout.ts'

export type PowerpointToPdfOptions = {
  /** include slides marked hidden */
  hidden: boolean
  /** fonts the panel found for the deck: installed, added from files or downloaded (empty: bundled look-alikes) */
  localFonts: InstalledFont[]
}

/** every font the slides' text asks for, with that text */
function fontNeeds(slides: Slide[]): FontNeed[] {
  const out: FontNeed[] = [{ name: 'Arial', text: '(not shown)Chart Diagram Object' }]
  for (const s of slides) {
    for (const sh of s.shapes) {
      const paras = sh.kind === 'text' ? sh.paragraphs : sh.kind === 'table' ? sh.cells.flat().flatMap((c) => c.paragraphs) : []
      for (const p of paras) for (const r of p.runs) out.push({ name: r.font, bold: r.bold, italic: r.italic, text: r.text + (p.bullet ?? '') + '0123456789.' })
      if (sh.kind === 'chart') out.push(...chartFontNeeds(sh.chart))
    }
  }
  return out
}

/** `fonts` loads the bundled look-alike fonts (the app's bundle by default; tests read them from disk) */
export async function run(files: FileData[], o: PowerpointToPdfOptions, { progress }: RunContext, fonts: FontSource = browserFonts): Promise<FileData[]> {
  const f = files[0]
  let deck
  try {
    deck = await readPptx(f.bytes)
  } catch (e) {
    throw e instanceof UserError ? new UserError(`${f.name}: ${e.message}`) : e
  }
  const slides = deck.slides.filter((s) => o.hidden || !s.hidden)
  if (!slides.length) throw new UserError('Every slide in this presentation is hidden. Turn on "Include hidden slides".')
  const book = new FontBook(fonts, o.localFonts ?? [])
  await book.load(fontNeeds(slides))
  const d = new PdfDrawing()
  d.title = baseName(f.name)
  // a picture used on many slides (a logo on the master) is stored once; the bytes of one part are the same object each time
  const ids = new Map<Uint8Array, number | null>()
  const pending: Promise<void>[] = []
  const decoded = new Map<Uint8Array, ImageInput | null>()
  const want = (bytes: Uint8Array, type: 'png' | 'jpeg' | 'other', name?: string) => {
    if (decoded.has(bytes)) return
    decoded.set(bytes, null)
    pending.push(imageInput(bytes, type, name).then((r) => void decoded.set(bytes, r)))
  }
  const paints = (p: Slide['backgroundPaint']) => p?.type === 'picture' && want(p.bytes, p.kind, p.name)
  for (const s of slides) {
    paints(s.backgroundPaint)
    for (const sh of s.shapes) {
      if (sh.kind === 'pic') want(sh.bytes, sh.type, sh.name)
      else if (sh.kind === 'text') paints(sh.paint)
    }
  }
  await Promise.all(pending)
  const imageFor = (p: { bytes: Uint8Array }) => {
    if (ids.has(p.bytes)) return ids.get(p.bytes)!
    const input = decoded.get(p.bytes)
    const id = input ? d.addImage(input) : null
    ids.set(p.bytes, id)
    return id
  }
  for (const [i, s] of slides.entries()) {
    progress(i / slides.length)
    drawSlide(d, s, { width: Math.min(14400, deck.width), height: Math.min(14400, deck.height) }, { book, imageFor })
  }
  progress(0.95)
  const { bytes } = await buildPdf(d)
  progress(1)
  return [pdfFile(`${baseName(f.name)}.pdf`, bytes)]
}
