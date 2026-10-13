/** the 2D drawing surface the renderer needs: a page canvas or an OffscreenCanvas (inside a worker) */
export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/**
 * The few things the renderer asks the host for. In a browser or worker these are canvas calls; keeping them behind
 * an interface leaves the rest of the renderer free of DOM types, and lets tests and other hosts supply their own.
 */
export interface Platform {
  /** something `drawImage` accepts, made from straight (non-premultiplied) RGBA pixels */
  imageFromRGBA(width: number, height: number, rgba: Uint8ClampedArray): CanvasImageSource
  /** decode a JPEG into RGBA pixels */
  decodeJpeg(bytes: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }>
}

export const browserPlatform: Platform = {
  imageFromRGBA(width, height, rgba) {
    const canvas = new OffscreenCanvas(width, height)
    canvas.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
    return canvas
  },
  async decodeJpeg(bytes) {
    // imageOrientation none: a PDF's JPEG is drawn as stored, whatever EXIF it may carry
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }), { imageOrientation: 'none' })
    try {
      const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bitmap, 0, 0)
      const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      return { width: d.width, height: d.height, rgba: d.data }
    } finally {
      bitmap.close()
    }
  },
}
