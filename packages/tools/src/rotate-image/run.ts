import { UserError, type FileData, type RunFn } from '@ream/core'
import { flip, rotate } from '@ream/image-core'
import { decodeFile, encodeFile, outName } from '../image-common.ts'
import { DEFAULT_QUALITY, formatFor } from '../image-formats.ts'

export type RotateOptions = {
  /** clockwise quarter turns */
  turns: 0 | 1 | 2 | 3
  flipH: boolean
  flipV: boolean
}

export const run: RunFn<RotateOptions> = async (files, { turns, flipH, flipV }, { progress }) => {
  if (!turns && !flipH && !flipV) throw new UserError('Choose a rotation or a flip first.')
  const outputs: FileData[] = []
  for (const [i, f] of files.entries()) {
    let img = await decodeFile(f)
    if (flipH) img = flip(img, 'horizontal')
    if (flipV) img = flip(img, 'vertical')
    img = rotate(img, turns)
    const fmt = formatFor(f.type)
    outputs.push(await encodeFile(img, fmt, DEFAULT_QUALITY, outName(f.name, '-rotated', fmt)))
    progress((i + 1) / files.length)
  }
  return outputs
}
