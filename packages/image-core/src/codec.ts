import type { ImageBuffer } from './buffer.ts'

export type OutputMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/bmp'

/** The only platform-specific part of image-core: bytes to pixels and back. Everything else is pure. */
export interface Codec {
  decode(bytes: Uint8Array, type: string): Promise<ImageBuffer>
  /** quality is 0..1 and only matters for lossy formats */
  encode(img: ImageBuffer, type: OutputMime, quality?: number): Promise<Uint8Array>
}

let current: Codec | null = null

export const setCodec = (c: Codec) => {
  current = c
}

export function codec(): Codec {
  if (!current) throw new Error('No image codec has been set')
  return current
}
