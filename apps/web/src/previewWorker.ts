import { UserError } from '@ream/core'
import { PdfDocument, PdfPasswordError, decryptPdf, readInfo } from '@ream/pdf-core'
import { pageGeometry, renderPage } from '@ream/pdf-render'

// One worker for everything that looks at a file without changing it: page counts, thumbnails, page renders and
// unlocking. The main thread never parses a PDF. Documents stay loaded here (a few at a time) so that thumbnails and
// page renders of the same file don't parse it again.

export type PdfInfo =
  | { kind: 'ok'; pages: { width: number; height: number }[] }
  | { kind: 'encrypted' }
  | { kind: 'error'; message: string }

export type UnlockResult = { kind: 'unlocked'; bytes: Uint8Array } | { kind: 'wrong' } | { kind: 'error'; message: string }
export type RenderedPage = { bitmap: ImageBitmap; width: number; height: number; warnings: string[] }

type Request =
  | { id: number; op: 'inspect'; docId: number; bytes?: Uint8Array }
  | { id: number; op: 'metadata'; docId: number; bytes?: Uint8Array }
  | { id: number; op: 'render'; docId: number; bytes?: Uint8Array; page: number; width: number }
  | { id: number; op: 'unlock'; bytes: Uint8Array; password: string }

const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

const MAX_DOCS = 8
const docs = new Map<number, Promise<PdfDocument>>()

/** the document for this id; `bytes` are needed the first time (the client resends them when we say they're missing) */
function getDoc(docId: number, bytes?: Uint8Array): Promise<PdfDocument> {
  const known = docs.get(docId)
  if (known) return known
  if (!bytes) throw Object.assign(new Error('missing'), { code: 'missing' })
  const loading = PdfDocument.load(bytes)
  docs.set(docId, loading)
  loading.catch(() => docs.delete(docId)) // a failed load (locked, damaged) isn't kept
  while (docs.size > MAX_DOCS) docs.delete(docs.keys().next().value!)
  return loading
}

async function inspect(docId: number, bytes?: Uint8Array): Promise<PdfInfo> {
  try {
    const doc = await getDoc(docId, bytes)
    return { kind: 'ok', pages: doc.pages().map((p) => doc.pageSize(p)) }
  } catch (e) {
    if (e instanceof PdfPasswordError) return { kind: 'encrypted' }
    if (e instanceof UserError) return { kind: 'error', message: e.message }
    throw e
  }
}

async function render(docId: number, page: number, width: number, bytes?: Uint8Array): Promise<RenderedPage> {
  const doc = await getDoc(docId, bytes)
  const geo = pageGeometry(doc, page, width)
  const canvas = new OffscreenCanvas(geo.width, geo.height)
  const { warnings } = await renderPage(doc, page, canvas.getContext('2d')!, width)
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
    if (req.op === 'inspect') post({ id: req.id, ok: true, result: await inspect(req.docId, req.bytes) })
    else if (req.op === 'metadata') post({ id: req.id, ok: true, result: readInfo(await getDoc(req.docId, req.bytes)) })
    else if (req.op === 'render') {
      const result = await render(req.docId, req.page, req.width, req.bytes)
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
