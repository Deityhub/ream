import { UserError } from '@ream/core'
import { PdfDocument, PdfEncryptedError } from '@ream/pdf-core'

// One worker for everything that looks at a file without changing it (page counts now, page renders later),
// so the main thread never parses a PDF.

export type PdfInfo =
  | { kind: 'ok'; pages: { width: number; height: number }[] }
  | { kind: 'encrypted' }
  | { kind: 'error'; message: string }

type Request = { id: number; op: 'inspect'; bytes: Uint8Array }

const post = (message: unknown) => (self as unknown as Worker).postMessage(message)

async function inspect(bytes: Uint8Array): Promise<PdfInfo> {
  try {
    const doc = await PdfDocument.load(bytes)
    return { kind: 'ok', pages: doc.pages().map((p) => doc.pageSize(p)) }
  } catch (e) {
    if (e instanceof PdfEncryptedError) return { kind: 'encrypted' }
    if (e instanceof UserError) return { kind: 'error', message: e.message }
    throw e
  }
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, op, bytes } = e.data
  try {
    if (op === 'inspect') post({ id, ok: true, result: await inspect(bytes) })
  } catch (err) {
    console.error(err)
    post({ id, ok: false, message: 'Something went wrong while reading this file.' })
  }
}
