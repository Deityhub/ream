import { UserError, type RunFn } from '@ream/core'
import { crop } from '@ream/image-core'
import { decodeFile, encodeFile, outName } from '../image-common.ts'
import { DEFAULT_QUALITY, formatFor } from '../image-formats.ts'
import { cropBox, type CropOptions } from './box.ts'

export type { CropOptions }

export const run: RunFn<CropOptions> = async (files, o, { progress }) => {
  const f = files[0]
  const img = await decodeFile(f)
  progress(0.5)
  const box = cropBox(o, img.width, img.height)
  if (box.w < 1 || box.h < 1) throw new UserError('Drag on the image to choose the area to keep.')
  const fmt = formatFor(f.type)
  return [await encodeFile(crop(img, box.x, box.y, box.w, box.h), fmt, DEFAULT_QUALITY, outName(f.name, '-cropped', fmt))]
}
