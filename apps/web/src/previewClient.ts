import type { PdfInfo, UnlockResult } from './previewWorker'

export type { PdfInfo, UnlockResult }

let worker: Worker | undefined
let seq = 0
const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function start(): Worker {
  const w = new Worker(new URL('./previewWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e) => {
    const { id, ok, result, message } = e.data
    const p = waiting.get(id)
    waiting.delete(id)
    if (ok) p?.resolve(result)
    else p?.reject(new Error(message))
  }
  w.onerror = () => {
    for (const p of waiting.values()) p.reject(new Error("Couldn't start the preview worker"))
    waiting.clear()
    worker = undefined
  }
  return w
}

function send<T>(msg: object, transfer: Transferable[] = []): Promise<T> {
  worker ??= start()
  return new Promise((resolve, reject) => {
    const id = ++seq
    waiting.set(id, { resolve, reject })
    worker!.postMessage({ id, ...msg }, transfer)
  })
}

const cache = new WeakMap<Blob, Promise<PdfInfo>>()

/** page count and sizes of a PDF, read in the worker; cached per file */
export function inspectPdf(file: Blob): Promise<PdfInfo> {
  let p = cache.get(file)
  if (!p) {
    p = file.arrayBuffer().then((buf) => send<PdfInfo>({ op: 'inspect', bytes: new Uint8Array(buf) }, [buf]))
    cache.set(file, p)
  }
  return p
}

const unlocked = new WeakSet<Blob>()
/** true for a decrypted copy made by unlockPdf, so the file list can say so */
export const wasUnlocked = (file: Blob) => unlocked.has(file)
export const markUnlocked = (file: Blob) => unlocked.add(file)

/** a decrypted copy of a password protected PDF; the password is used once here and not kept */
export async function unlockPdf(file: Blob, password: string): Promise<UnlockResult> {
  const buf = await file.arrayBuffer()
  return send<UnlockResult>({ op: 'unlock', bytes: new Uint8Array(buf), password }, [buf])
}
