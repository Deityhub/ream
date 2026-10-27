import { UserError, type FileData, type RunFn } from '@ream/core'
import { decodePng, overlay, resize } from '@ream/image-core'
import { decodeFile, encodeFile, outName } from '../image-common.ts'
import { DEFAULT_QUALITY, formatFor } from '../image-formats.ts'
import { markSize, placements, type PlaceOptions } from './place.ts'

export type WatermarkImageOptions = PlaceOptions & {
  /** the mark as a PNG with a transparent background, made by the panel from text or a logo (turned already if it is slanted) */
  mark: Uint8Array | null
  /** 5..100 */
  opacity: number
  // what the mark was made from, kept so the panel can show it again; the run doesn't use these
  source: 'text' | 'logo'
  text: string
  bold: boolean
  italic: boolean
  colour: string
  angle: number
}

export const run: RunFn<WatermarkImageOptions> = async (files, o, { progress }) => {
  if (!o.mark) throw new UserError(o.source === 'logo' ? 'Choose a logo to stamp on the pictures.' : 'Type the text to stamp on the pictures.')
  const mark = await decodePng(o.mark)
  const outputs: FileData[] = []
  for (const [i, f] of files.entries()) {
    const img = await decodeFile(f)
    const { w, h } = markSize(img, mark, o)
    const scaled = w === mark.width && h === mark.height ? mark : resize(mark, w, h)
    for (const p of placements(img, w, h, o)) overlay(img, scaled, p.x, p.y, o.opacity / 100)
    const fmt = formatFor(f.type)
    outputs.push(await encodeFile(img, fmt, DEFAULT_QUALITY, outName(f.name, '-watermarked', fmt)))
    progress((i + 1) / files.length)
  }
  return outputs
}
