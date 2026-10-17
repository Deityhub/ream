import { UserError, type FileData, type RunFn } from '@ream/core'
import { decodeBmp, decodeGif, decodeJpeg, decodePng } from '@ream/image-core'
import { readPptx } from '@ream/office-core'
import { PdfDrawing, buildPdf, jpegInfo, prepareFont, type ImageInput } from '@ream/pdf-core'
import { baseName } from '../names.ts'
import { pdfFile } from '../pdf-common.ts'
import { drawSlide } from './layout.ts'

export type PowerpointToPdfOptions = {
  /** include slides marked hidden */
  hidden: boolean
  /** a .ttf for text the standard fonts cannot show (other scripts); every text then uses it */
  fontFile: Uint8Array | null
  fontName: string
}

/** a picture as the PDF builder takes it: a JPEG as it is, anything else as pixels; null for formats Ream cannot read (EMF, WMF, SVG ...) */
async function imageInput(bytes: Uint8Array, type: 'png' | 'jpeg' | 'other', name?: string): Promise<ImageInput | null> {
  try {
    if (type === 'jpeg') {
      const info = jpegInfo(bytes)
      if (info && info.orientation === 1) return { width: info.width, height: info.height, jpeg: bytes, components: info.components, adobe: info.adobe }
      const px = decodeJpeg(bytes)
      return { width: px.width, height: px.height, rgba: px.data }
    }
    if (type === 'png') {
      const px = await decodePng(bytes)
      return { width: px.width, height: px.height, rgba: px.data }
    }
    const ext = name?.split('.').pop()?.toLowerCase()
    if (ext === 'gif') {
      const gif = decodeGif(bytes)
      const f = gif.frames[0]
      return f ? { width: gif.width, height: gif.height, rgba: f.image.data } : null
    }
    if (ext === 'bmp') {
      const px = decodeBmp(bytes)
      return { width: px.width, height: px.height, rgba: px.data }
    }
  } catch {
    // a picture that cannot be read leaves a grey box where it was
  }
  return null
}

export const run: RunFn<PowerpointToPdfOptions> = async (files, o, { progress }) => {
  const f = files[0]
  let deck
  try {
    deck = await readPptx(f.bytes)
  } catch (e) {
    throw e instanceof UserError ? new UserError(`${f.name}: ${e.message}`) : e
  }
  const slides = deck.slides.filter((s) => o.hidden || !s.hidden)
  if (!slides.length) throw new UserError('Every slide in this presentation is hidden. Turn on "Include hidden slides".')
  const emb = o.fontFile ? await prepareFont(o.fontFile, slides.flatMap((s) => s.shapes.flatMap((sh) => (sh.kind === 'text' ? sh.paragraphs : sh.kind === 'table' ? sh.cells.flat().flatMap((c) => c.paragraphs) : []).flatMap((p) => p.runs.map((r) => r.text)))).join('')) : null
  const d = new PdfDrawing()
  d.title = baseName(f.name)
  // a picture used on many slides (a logo on the master) is stored once; the bytes of one part are the same object each time
  const ids = new Map<Uint8Array, number | null>()
  const pending: Promise<void>[] = []
  const decoded = new Map<Uint8Array, ImageInput | null>()
  for (const s of slides) {
    for (const sh of [...s.shapes, ...(s.backgroundPicture ? [{ kind: 'pic' as const, ...s.backgroundPicture, x: 0, y: 0, w: 0, h: 0 }] : [])]) {
      if (sh.kind === 'pic' && !decoded.has(sh.bytes)) {
        decoded.set(sh.bytes, null)
        pending.push(imageInput(sh.bytes, sh.type, sh.name).then((r) => void decoded.set(sh.bytes, r)))
      }
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
    drawSlide(d, s, { width: Math.min(14400, deck.width), height: Math.min(14400, deck.height) }, { emb, imageFor })
  }
  progress(0.95)
  const { bytes } = await buildPdf(d, emb)
  progress(1)
  return [pdfFile(`${baseName(f.name)}.pdf`, bytes)]
}
