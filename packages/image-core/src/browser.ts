import { UserError } from '@ream/core'
import { UnsupportedImage, checkPixels, type ImageBuffer } from './buffer.ts'
import type { Codec, OutputMime } from './codec.ts'
import { ownCodec } from './own.ts'

const LABEL: Partial<Record<OutputMime, string>> = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WebP' }

/** The browser's own decoders and encoders, through ImageBitmap and OffscreenCanvas (works inside a Web Worker). */
export const browserCodec: Codec = {
  async decode(bytes, type) {
    let bitmap: ImageBitmap
    try {
      // samples as stored, like our decoder (a colour profile is carried over by the tools that keep it, not applied); turned upright by EXIF
      bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }), { colorSpaceConversion: 'none', imageOrientation: 'from-image' })
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

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8
const opaque = (img: ImageBuffer) => {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) return false
  return true
}

/**
 * What the app uses: the browser's native codec where it is many times faster than ours (JPEG both ways, PNG writing),
 * ours for everything else and whenever the browser fails. A canvas stores premultiplied alpha, so it can't keep
 * see-through pixels exact: PNGs with transparency, and every PNG read, stay with ours (lossless stays lossless).
 * GIF and BMP are ours only: browsers can't write them.
 */
export const appCodec: Codec = {
  async decode(bytes, type) {
    if (isJpeg(bytes)) {
      try {
        return await browserCodec.decode(bytes, 'image/jpeg')
      } catch {
        // ours gives the precise reason, or reads what the browser couldn't
      }
    }
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
  async encode(img, type, quality) {
    if (type === 'image/webp') return browserCodec.encode(img, type, quality)
    if (type === 'image/jpeg' || (type === 'image/png' && opaque(img))) {
      try {
        return await browserCodec.encode(img, type, quality)
      } catch {
        // too big for a canvas here, or out of memory: ours can still do it
      }
    }
    return ownCodec.encode(img, type, quality)
  },
}
