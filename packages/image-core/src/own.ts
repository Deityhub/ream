import { UserError } from '@ream/core'
import { encodeBmp, decodeBmp } from './bmp.ts'
import { UnsupportedImage } from './buffer.ts'
import type { Codec } from './codec.ts'
import { decodeGif, encodeGif } from './gif.ts'
import { decodeJpeg } from './jpeg/decode.ts'
import { encodeJpeg } from './jpeg/encode.ts'
import { orient } from './ops.ts'
import { decodePng, encodePng } from './png.ts'

const is = (b: Uint8Array, ...sig: number[]) => sig.every((v, i) => b[i] === v)

/**
 * Our own codec, no canvas needed. Reads PNG, JPEG, GIF (first frame) and BMP; writes PNG, JPEG, GIF (one frame) and
 * BMP. WebP, and the odd file using features we don't do, need the browser (see `appCodec`).
 */
export const ownCodec: Codec = {
  async decode(bytes, type) {
    if (is(bytes, 0x89, 0x50, 0x4e, 0x47)) return decodePng(bytes)
    if (is(bytes, 0xff, 0xd8)) {
      const { orientation, components: _components, ...img } = decodeJpeg(bytes)
      return orient(img, orientation)
    }
    if (is(bytes, 0x47, 0x49, 0x46, 0x38)) return decodeGif(bytes, { firstOnly: true }).frames[0].image
    if (is(bytes, 0x42, 0x4d)) return decodeBmp(bytes)
    // no known signature: a file called .png (and so on) that isn't one gets that format's own message
    if (type === 'image/png') return decodePng(bytes)
    if (type === 'image/jpeg') decodeJpeg(bytes)
    if (type === 'image/gif') decodeGif(bytes)
    if (type === 'image/bmp') decodeBmp(bytes)
    throw new UnsupportedImage("This codec can't read that kind of image.")
  },
  async encode(img, type, quality = 0.92) {
    if (type === 'image/png') return encodePng(img)
    if (type === 'image/jpeg') return encodeJpeg(img, { quality: quality * 100 })
    if (type === 'image/gif') return encodeGif([{ image: img, delay: 0 }])
    if (type === 'image/bmp') return encodeBmp(img)
    throw new UserError('This codec can only write PNG, JPEG, GIF and BMP files.')
  },
}
