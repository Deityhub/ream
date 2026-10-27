import { UserError, type RunFn } from '@ream/core'
import { decodePng, overlay, resize, type ImageBuffer } from '@ream/image-core'
import { decodeFile, encodeFile, outName } from '../image-common.ts'
import { DEFAULT_QUALITY, formatFor } from '../image-formats.ts'

export type MemeOptions = {
  top: string
  bottom: string
  /** font size as a percentage of the picture's width */
  size: number
  colour: string
  // the two captions as PNGs as wide as the picture, drawn by the panel (the browser has the font); the run only places them
  topPng: Uint8Array | null
  bottomPng: Uint8Array | null
}

/** the gap between a caption and the edge of the picture, as a share of its height */
export const EDGE = 0.02

export async function captionLayer(png: Uint8Array, width: number): Promise<ImageBuffer> {
  const c = await decodePng(png)
  return c.width === width ? c : resize(c, width, Math.max(1, Math.round((c.height * width) / c.width)))
}

export const run: RunFn<MemeOptions> = async (files, o, { progress }) => {
  if (!o.topPng && !o.bottomPng) throw new UserError('Type a caption for the top or the bottom.')
  const f = files[0]
  const img = await decodeFile(f)
  progress(0.4)
  const gap = Math.round(img.height * EDGE)
  if (o.topPng) overlay(img, await captionLayer(o.topPng, img.width), 0, gap)
  if (o.bottomPng) {
    const b = await captionLayer(o.bottomPng, img.width)
    overlay(img, b, 0, img.height - b.height - gap)
  }
  const fmt = formatFor(f.type)
  return [await encodeFile(img, fmt, DEFAULT_QUALITY, outName(f.name, '-meme', fmt))]
}
