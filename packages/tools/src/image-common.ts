import { UserError, type FileData } from '@ream/core'
import { codec, flattenOnWhite, type ImageBuffer } from '@ream/image-core'
import { baseName } from './names.ts'
import type { Format } from './image-formats.ts'

// Pictures decoded in earlier runs, by input key: a preview after an option change skips decoding (seconds for a big
// photo). Tools change the pixels they get, so each caller gets its own copy.
// ponytail: whole pictures kept up to a fixed budget; keep a smaller copy too if previews of many big files matter
const decoded = new Map<string, ImageBuffer>()
const BUDGET = 512 * 1024 ** 2

/** forget pictures of inputs other than these (the app's worker calls it before each run) */
export function keepDecoded(keys: (string | undefined)[]) {
  for (const k of decoded.keys()) if (!keys.includes(k)) decoded.delete(k)
}

/** decode an input image, prefixing user-facing errors with the file name */
export async function decodeFile(f: FileData): Promise<ImageBuffer> {
  const kept = f.key === undefined ? undefined : decoded.get(f.key)
  if (kept) return { ...kept, data: kept.data.slice() }
  let img: ImageBuffer
  try {
    img = await codec().decode(f.bytes, f.type)
  } catch (e) {
    throw e instanceof UserError ? new UserError(`${f.name}: ${e.message}`) : e
  }
  const used = [...decoded.values()].reduce((n, i) => n + i.data.length, 0)
  if (f.key === undefined || used + img.data.length > BUDGET) return img
  decoded.set(f.key, img)
  return { ...img, data: img.data.slice() }
}

/** quality is 1-100; formats without transparency (JPG) get transparent areas flattened onto white */
export async function encodeFile(img: ImageBuffer, fmt: Format, quality: number, name: string): Promise<FileData> {
  const src = fmt.mime === 'image/jpeg' ? flattenOnWhite(img) : img
  return { name, type: fmt.mime, bytes: await codec().encode(src, fmt.mime, quality / 100) }
}

/** "photo.heic" + "-resized" + PNG -> "photo-resized.png" */
export const outName = (input: string, suffix: string, fmt: Format) => `${baseName(input)}${suffix}.${fmt.ext}`
