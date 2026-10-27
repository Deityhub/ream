import { UserError, type RunFn } from '@ream/core'
import { decodeFile, encodeFile, outName } from '../image-common.ts'
import { DEFAULT_QUALITY, formatFor } from '../image-formats.ts'
import { applyAreas, type BlurOptions } from './apply.ts'

export type { BlurOptions }

export const run: RunFn<BlurOptions> = async (files, o, { progress }) => {
  if (!o.areas.length) throw new UserError('Drag on the picture to choose what to blur or cover.')
  const f = files[0]
  const img = await decodeFile(f)
  progress(0.5)
  applyAreas(img, o)
  const fmt = formatFor(f.type)
  // the picture is encoded afresh, so nothing of the hidden pixels (or a small copy of the original) travels with it
  return [await encodeFile(img, fmt, DEFAULT_QUALITY, outName(f.name, o.mode === 'box' ? '-covered' : '-blurred', fmt))]
}
