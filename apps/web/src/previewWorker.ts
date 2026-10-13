import { UserError } from '@ream/core'
import { PdfDocument, PdfPasswordError, decryptPdf } from '@ream/pdf-core'

// One worker for everything that looks at a file without changing it (page counts now, page renders later),
// so the main thread never parses a PDF.

export type PdfInfo =
  | { kind: 'ok'; pages: { width: number; height: number }[] }
  | { kind: 'encrypted' }
  | { kind: 'error'; message: string }

export type UnlockResult = { kind: 'unlocked'; bytes: Uint8Array } | { kind: 'wrong' } | { kind: 'error'; message: string }

type Request = { id: number; op: 'inspect'; bytes: Uint8Array } | { id: number; op: 'unlock'; bytes: Uint8Array; password: string }

const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

async function inspect(bytes: Uint8Array): Promise<PdfInfo> {
  try {
    const doc = await PdfDocument.load(bytes)
    return { kind: 'ok', pages: doc.pages().map((p) => doc.pageSize(p)) }
  } catch (e) {
    if (e instanceof PdfPasswordError) return { kind: 'encrypted' }
    if (e instanceof UserError) return { kind: 'error', message: e.message }
    throw e
  }
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
    if (req.op === 'inspect') post({ id: req.id, ok: true, result: await inspect(req.bytes) })
    else {
      const result = await unlock(req.bytes, req.password)
      post({ id: req.id, ok: true, result }, result.kind === 'unlocked' ? [result.bytes.buffer as ArrayBuffer] : [])
    }
  } catch (err) {
    const id = req.id
    console.error(err)
    post({ id, ok: false, message: 'Something went wrong while reading this file.' })
  }
}
