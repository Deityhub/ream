// Pictures from Office files, ready for the PDF builder.
import { decodeBmp, decodeGif, decodeJpeg, decodePng } from '@ream/image-core'
import { jpegInfo, type ImageInput } from '@ream/pdf-core'

/** a picture as the PDF builder takes it: a JPEG as it is, anything else as pixels; null for formats Ream cannot read (EMF, WMF, SVG ...) */
export async function imageInput(bytes: Uint8Array, type: 'png' | 'jpeg' | 'other', name?: string): Promise<ImageInput | null> {
  try {
    if (type === 'jpeg') {
      const info = jpegInfo(bytes)
      if (info && info.orientation === 1) return { width: info.width, height: info.height, jpeg: bytes, components: info.components, adobe: info.adobe }
      const px = decodeJpeg(bytes)
      return { width: px.width, height: px.height, rgba: px.data }
    }
    if (type === 'png') {
      const px = await decodePng(bytes)
      return { width: px.width, height: px.height, rgba: px.data }
    }
    const ext = name?.split('.').pop()?.toLowerCase()
    if (ext === 'gif') {
      const gif = decodeGif(bytes)
      const f = gif.frames[0]
      return f ? { width: gif.width, height: gif.height, rgba: f.image.data } : null
    }
    if (ext === 'bmp') {
      const px = decodeBmp(bytes)
      return { width: px.width, height: px.height, rgba: px.data }
    }
  } catch {
    // a picture that cannot be read leaves a grey box where it was
  }
  return null
}

