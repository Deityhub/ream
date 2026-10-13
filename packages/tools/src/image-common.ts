import { UserError, type FileData } from '@ream/core'
import { codec, flattenOnWhite, type ImageBuffer } from '@ream/image-core'
import { baseName } from './names.ts'
import type { Format } from './image-formats.ts'

/** decode an input image, prefixing user-facing errors with the file name */
export async function decodeFile(f: FileData): Promise<ImageBuffer> {
  try {
    return await codec().decode(f.bytes, f.type)
  } catch (e) {
    throw e instanceof UserError ? new UserError(`${f.name}: ${e.message}`) : e
  }
}

/** quality is 1-100; formats without transparency (JPG) get transparent areas flattened onto white */
export async function encodeFile(img: ImageBuffer, fmt: Format, quality: number, name: string): Promise<FileData> {
  const src = fmt.mime === 'image/jpeg' ? flattenOnWhite(img) : img
  return { name, type: fmt.mime, bytes: await codec().encode(src, fmt.mime, quality / 100) }
}

/** "photo.heic" + "-resized" + PNG -> "photo-resized.png" */
export const outName = (input: string, suffix: string, fmt: Format) => `${baseName(input)}${suffix}.${fmt.ext}`
