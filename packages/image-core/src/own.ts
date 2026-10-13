import { UserError } from '@ream/core'
import type { Codec } from './codec.ts'
import { decodePng, encodePng } from './png.ts'

/** Our own codec: PNG only for now (GIF, BMP and JPEG arrive in M4). Runs anywhere, no canvas needed. */
export const ownCodec: Codec = {
  decode: (bytes) => decodePng(bytes),
  async encode(img, type) {
    if (type !== 'image/png') throw new UserError('This codec can only write PNG files.')
    return encodePng(img)
  },
}
