import { UserError, type FileData, type RunFn } from '@ream/core'
import { adjust, blur, sharpen, type ImageBuffer } from '@ream/image-core'
import { decodeFile, encodeFile, outName } from '../image-common.ts'
import { DEFAULT_QUALITY, formatFor } from '../image-formats.ts'
import { isUnchanged, type FilterOptions } from './presets.ts'

export type { FilterOptions }

/** blur and sharpen are percentages that scale with the picture, so a small copy and the original look alike */
export function applyFilters(img: ImageBuffer, o: FilterOptions): void {
  const side = Math.max(img.width, img.height)
  if (o.blur) blur(img, Math.max(1, Math.round((o.blur / 100) * (side / 40))))
  adjust(img, o)
  if (o.sharpen) sharpen(img, o.sharpen / 50, Math.max(1, Math.round(side / 1200)))
}

export const run: RunFn<FilterOptions> = async (files, o, { progress }) => {
  if (isUnchanged(o)) throw new UserError('Choose a look or move a slider first.')
  const outputs: FileData[] = []
  for (const [i, f] of files.entries()) {
    const img = await decodeFile(f)
    applyFilters(img, o)
    const fmt = formatFor(f.type)
    outputs.push(await encodeFile(img, fmt, DEFAULT_QUALITY, outName(f.name, '-filtered', fmt)))
    progress((i + 1) / files.length)
  }
  return outputs
}
