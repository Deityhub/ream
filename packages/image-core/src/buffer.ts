import { UserError } from '@ream/core'

/** Decoded image: straight (non-premultiplied) RGBA, 8 bits per channel, row-major. */
export type ImageBuffer = { width: number; height: number; data: Uint8ClampedArray }

export const createImage = (width: number, height: number): ImageBuffer => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4),
})

// RGBA at 4 bytes per pixel: 120 megapixels is about 480 MB, near what a browser tab can hold
export const MAX_PIXELS = 120_000_000

/** `subject` completes the sentence, e.g. "This image is" or "The result would be" */
export function checkPixels(width: number, height: number, subject: string): void {
  if (width * height > MAX_PIXELS) {
    throw new UserError(`${subject} ${Math.round((width * height) / 1e6)} megapixels. The limit is ${MAX_PIXELS / 1e6}.`)
  }
}

/** A picture that is valid but uses something our own decoders don't do (the browser codec may still be able to read it). */
export class UnsupportedImage extends UserError {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedImage'
  }
}
