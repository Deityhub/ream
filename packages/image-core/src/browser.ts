import { UserError } from '@ream/core'
import { UnsupportedImage, checkPixels } from './buffer.ts'
import type { Codec, OutputMime } from './codec.ts'
import { ownCodec } from './own.ts'

const LABEL: Partial<Record<OutputMime, string>> = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WebP' }

/** The browser's own decoders and encoders, through ImageBitmap and OffscreenCanvas (works inside a Web Worker). */
export const browserCodec: Codec = {
  async decode(bytes, type) {
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }))
    } catch {
      throw new UserError("Couldn't read this image. It may be damaged, or this browser can't open that kind of file.")
    }
    const { width, height } = bitmap
    try {
      checkPixels(width, height, 'This image is')
      const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bitmap, 0, 0)
      return { width, height, data: ctx.getImageData(0, 0, width, height).data }
    } finally {
      bitmap.close()
    }
  },

  async encode(img, type, quality = 0.92) {
    const canvas = new OffscreenCanvas(img.width, img.height)
    canvas.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
    const blob = await canvas.convertToBlob({ type, quality })
    // browsers silently fall back to PNG for types they can't write
    if (blob.type !== type) throw new UserError(`This browser can't create ${LABEL[type] ?? 'that kind of'} files.`)
    return new Uint8Array(await blob.arrayBuffer())
  },
}

/**
 * What the app uses: our own codec for everything it can do, the browser only for WebP and for files that use something
 * ours doesn't (when the browser can't read them either, the more precise message of ours is shown).
 */
export const appCodec: Codec = {
  async decode(bytes, type) {
    try {
      return await ownCodec.decode(bytes, type)
    } catch (e) {
      if (!(e instanceof UnsupportedImage)) throw e
      try {
        return await browserCodec.decode(bytes, type)
      } catch {
        throw e
      }
    }
  },
  encode: (img, type, quality) => (type === 'image/webp' ? browserCodec : ownCodec).encode(img, type, quality),
}
