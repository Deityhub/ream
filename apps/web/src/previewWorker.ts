import { UserError } from '@ream/core'
import { PdfDocument, PdfPasswordError, decryptPdf, fontFaces, readForm, readInfo, readOutline, woffToSfnt, type FontFaceInfo, type FormInfo, type OutlineItem } from '@ream/pdf-core'
import { readImageMetadata, type MetadataSummary } from '@ream/image-core'
import { pageChars, pageGeometry, renderPage } from '@ream/pdf-render'
import { usedFonts } from '@ream/office-core'
import { officeToPdf, type OfficeKind } from '@ream/tools/office-preview'
import { installStandardFonts } from '@ream/tools/standard-fonts'

// One worker for everything that looks at a file without changing it: page counts, thumbnails, page renders and
// unlocking. The main thread never parses a PDF. Documents stay loaded here (a few at a time) so that thumbnails and
// page renders of the same file don't parse it again. Office files are converted to a PDF once (the converters with
// their default settings) and previewed as that PDF.

installStandardFonts()

export type PdfInfo =
  | { kind: 'ok'; pages: { width: number; height: number }[]; /** the file's index was wrong and the objects were found by scanning */ rebuilt: boolean }
  | { kind: 'encrypted' }
  | { kind: 'error'; message: string }

export type UnlockResult = { kind: 'unlocked'; bytes: Uint8Array } | { kind: 'wrong' } | { kind: 'error'; message: string }
export type { FormInfo, OutlineItem }
export type ImageMetadata = MetadataSummary | null
export type RenderedPage = { bitmap: ImageBitmap; width: number; height: number; warnings: string[] }
/** a font file someone added: its faces, and the file itself (a web font unpacked to TrueType or OpenType) */
export type FontFileInfo = { faces: FontFaceInfo[]; bytes: Uint8Array }

type Request =
  | { id: number; op: 'inspect'; docId: number; bytes?: Uint8Array; office?: OfficeKind }
  | { id: number; op: 'metadata'; docId: number; bytes?: Uint8Array; office?: OfficeKind }
  | { id: number; op: 'outline'; docId: number; bytes?: Uint8Array; office?: OfficeKind }
  | { id: number; op: 'form'; docId: number; bytes?: Uint8Array; office?: OfficeKind }
  | { id: number; op: 'chars'; docId: number; page: number; bytes?: Uint8Array; office?: OfficeKind }
  | { id: number; op: 'render'; docId: number; bytes?: Uint8Array; office?: OfficeKind; page: number; width: number; fields?: boolean }
  | { id: number; op: 'unlock'; bytes: Uint8Array; password: string }
  | { id: number; op: 'imageMetadata'; bytes: Uint8Array }
  | { id: number; op: 'officeFonts'; bytes: Uint8Array }
  | { id: number; op: 'fontFile'; bytes: Uint8Array }

const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

const MAX_DOCS = 8
const docs = new Map<number, Promise<PdfDocument>>()
const converted = new Set<number>()

/** the document for this id; `bytes` are needed the first time (the client resends them when we say they're missing) */
function getDoc(docId: number, bytes?: Uint8Array, office?: OfficeKind): Promise<PdfDocument> {
  const known = docs.get(docId)
  if (known) return known
  if (!bytes) throw Object.assign(new Error('missing'), { code: 'missing' })
  if (office) converted.add(docId)
  else converted.delete(docId)
  const loading = office ? officeToPdf({ name: `file.${office}`, type: '', bytes }, office).then((pdf) => PdfDocument.load(pdf)) : PdfDocument.load(bytes)
  docs.set(docId, loading)
  loading.catch(() => docs.delete(docId)) // a failed load (locked, damaged) isn't kept
  while (docs.size > MAX_DOCS) docs.delete(docs.keys().next().value!)
  return loading
}

async function inspect(docId: number, bytes?: Uint8Array, office?: OfficeKind): Promise<PdfInfo> {
  try {
    const doc = await getDoc(docId, bytes, office)
    return { kind: 'ok', pages: doc.pages().map((p) => doc.pageSize(p)), rebuilt: doc.rebuilt }
  } catch (e) {
    if (e instanceof PdfPasswordError) return { kind: 'encrypted' }
    if (e instanceof UserError) return { kind: 'error', message: e.message }
    throw e
  }
}

async function render(docId: number, page: number, width: number, bytes?: Uint8Array, office?: OfficeKind, fields = true): Promise<RenderedPage> {
  const doc = await getDoc(docId, bytes, office)
  const geo = pageGeometry(doc, page, width)
  const canvas = new OffscreenCanvas(geo.width, geo.height)
  const { warnings } = await renderPage(doc, page, canvas.getContext('2d')!, width, { fields })
  if (converted.has(docId)) warnings.unshift('it is drawn from our own conversion of the Office file')
  return { bitmap: canvas.transferToImageBitmap(), width: geo.width, height: geo.height, warnings }
}

/** the file without its password protection, or why that wasn't possible */
async function unlock(bytes: Uint8Array, password: string): Promise<UnlockResult> {
  try {
    return { kind: 'unlocked', bytes: await decryptPdf(bytes, password) }
  } catch (e) {
    if (e instanceof PdfPasswordError) return { kind: 'wrong' }
    if (e instanceof UserError) return { kind: 'error', message: e.message }
    throw e
  }
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data
  try {
    if (req.op === 'inspect') post({ id: req.id, ok: true, result: await inspect(req.docId, req.bytes, req.office) })
    else if (req.op === 'metadata') post({ id: req.id, ok: true, result: readInfo(await getDoc(req.docId, req.bytes, req.office)) })
    else if (req.op === 'outline') post({ id: req.id, ok: true, result: readOutline(await getDoc(req.docId, req.bytes, req.office)) })
    else if (req.op === 'form') post({ id: req.id, ok: true, result: readForm(await getDoc(req.docId, req.bytes, req.office)) })
    else if (req.op === 'chars') post({ id: req.id, ok: true, result: await letterBoxes(await getDoc(req.docId, req.bytes, req.office), req.page) })
    else if (req.op === 'imageMetadata') post({ id: req.id, ok: true, result: readImageMetadata(req.bytes) })
    else if (req.op === 'officeFonts') post({ id: req.id, ok: true, result: await usedFonts(req.bytes) })
    else if (req.op === 'fontFile') {
      const bytes = String.fromCharCode(...req.bytes.subarray(0, 4)) === 'wOFF' ? await woffToSfnt(req.bytes).catch(() => req.bytes) : req.bytes
      post({ id: req.id, ok: true, result: { faces: fontFaces(bytes), bytes } satisfies FontFileInfo }, [bytes.buffer as ArrayBuffer])
    }
    else if (req.op === 'render') {
      const result = await render(req.docId, req.page, req.width, req.bytes, req.office, req.fields !== false)
      post({ id: req.id, ok: true, result }, [result.bitmap])
    } else {
      const result = await unlock(req.bytes, req.password)
      post({ id: req.id, ok: true, result }, result.kind === 'unlocked' ? [result.bytes.buffer as ArrayBuffer] : [])
    }
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code !== 'missing') console.error(err)
    post({ id: req.id, ok: false, code, message: 'Something went wrong while reading this file.' })
  }
}

/** the letters of a page with their boxes, as fractions of the page as displayed (y from the top), for marking text */
async function letterBoxes(doc: PdfDocument, page: number): Promise<{ text: string; x0: number; y0: number; x1: number; y1: number }[]> {
  const { chars, width, height } = await pageChars(doc, page)
  // a letter's box: from its baseline up by most of its size, and a little below for descenders
  return chars.filter((c) => !c.invisible && Math.abs(c.angle) < 1).map((c) => ({ text: c.text, x0: c.x0 / width, x1: c.x1 / width, y0: (c.y0 - c.size * 0.8) / height, y1: (c.y0 + c.size * 0.2) / height }))
}
