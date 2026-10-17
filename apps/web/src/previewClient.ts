import { officeKind } from './usePdfInfo'
import type { FontFileInfo, ImageMetadata, OutlineItem, PdfInfo, RenderedPage, UnlockResult } from './previewWorker'

export type { FontFileInfo, ImageMetadata, OutlineItem, PdfInfo, RenderedPage, UnlockResult }

let worker: Worker | undefined
let seq = 0
const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function start(): Worker {
  const w = new Worker(new URL('./previewWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e) => {
    const { id, ok, result, message, code } = e.data
    const p = waiting.get(id)
    waiting.delete(id)
    if (ok) p?.resolve(result)
    else p?.reject(Object.assign(new Error(message), { code }))
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

// Each file gets an id; the worker keeps the parsed document under it. The first request after the worker has
// forgotten (or never saw) a document fails with code "missing", and we resend with the file's bytes.
const ids = new WeakMap<Blob, number>()
let nextId = 0
function idOf(file: Blob): number {
  let id = ids.get(file)
  if (id === undefined) ids.set(file, (id = ++nextId))
  return id
}

async function withDoc<T>(file: Blob, msg: object): Promise<T> {
  const docId = idOf(file)
  try {
    return await send<T>({ ...msg, docId })
  } catch (e) {
    if ((e as { code?: string }).code !== 'missing') throw e
    const buf = await file.arrayBuffer()
    const office = officeKind((file as File).name ?? '') ?? undefined
    return send<T>({ ...msg, docId, office, bytes: new Uint8Array(buf) }, [buf])
  }
}

const infoCache = new WeakMap<Blob, Promise<PdfInfo>>()

/** page count and sizes of a PDF (or of the preview PDF of an Office file), read in the worker; cached per file */
export function inspectPdf(file: Blob): Promise<PdfInfo> {
  let p = infoCache.get(file)
  if (!p) infoCache.set(file, (p = withDoc<PdfInfo>(file, { op: 'inspect' })))
  return p
}

/** the document information (title, author, ...) of a PDF, read in the worker */
export const readPdfMetadata = (file: Blob) => withDoc<Record<string, string>>(file, { op: 'metadata' })

/** the bookmarks of a PDF, read in the worker */
export const readPdfOutline = (file: Blob) => withDoc<OutlineItem[]>(file, { op: 'outline' })

// Rendered pages are kept briefly so a thumbnail and a bigger preview of the same page, or a re-mounted component,
// don't render twice. Oldest entries are closed to give the memory back.
const MAX_RENDERS = 200 // enough for a grid of page thumbnails
const renders = new Map<string, Promise<RenderedPage>>()

/** page `page` (0-based) of a PDF drawn `width` pixels wide, as a bitmap to paint on a canvas */
export function renderPdfPage(file: Blob, page: number, width: number): Promise<RenderedPage> {
  const key = `${idOf(file)}:${page}:${width}`
  let p = renders.get(key)
  if (p) {
    renders.delete(key) // refresh recency
  } else {
    p = withDoc<RenderedPage>(file, { op: 'render', page, width })
    p.catch(() => renders.delete(key))
  }
  renders.set(key, p)
  while (renders.size > MAX_RENDERS) {
    const [oldKey, old] = renders.entries().next().value!
    renders.delete(oldKey)
    old.then((r) => r.bitmap.close(), () => {})
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

/** the font names a .pptx or .xlsx uses, read in the worker */
export async function readOfficeFonts(file: Blob): Promise<string[]> {
  const buf = await file.arrayBuffer()
  return send<string[]>({ op: 'officeFonts', bytes: new Uint8Array(buf) }, [buf])
}

/** the faces in a font file someone added, read in the worker */
export async function readFontFile(file: Blob): Promise<FontFileInfo> {
  const buf = await file.arrayBuffer()
  return send<FontFileInfo>({ op: 'fontFile', bytes: new Uint8Array(buf) }, [buf])
}

const imageInfo = new WeakMap<Blob, Promise<ImageMetadata>>()

/** what a JPEG or PNG says about itself (camera, date, location ...), read in the worker; cached per file */
export function readImageMetadata(file: Blob): Promise<ImageMetadata> {
  let p = imageInfo.get(file)
  if (!p) {
    p = file.arrayBuffer().then((buf) => send<ImageMetadata>({ op: 'imageMetadata', bytes: new Uint8Array(buf) }, [buf]))
    imageInfo.set(file, p)
  }
  return p
}
