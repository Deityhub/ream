import { UserError, type RunFn } from '@ream/core'
import { stitch, type OutputMime, type StitchOptions } from '@ream/image-core'
import { decodeFile, encodeFile } from '../image-common.ts'
import { formatFor } from '../image-formats.ts'

export type MergeImagesOptions = StitchOptions & { format: OutputMime; quality: number }

export const run: RunFn<MergeImagesOptions> = async (files, { format, quality, ...layout }, { progress }) => {
  if (files.length < 2) throw new UserError('Add at least two images to merge.')
  const images = []
  for (const [i, f] of files.entries()) {
    images.push(await decodeFile(f))
    progress((i + 1) / (files.length + 1))
  }
  const fmt = formatFor(format)
  const out = await encodeFile(stitch(images, layout), fmt, quality, `merged.${fmt.ext}`)
  progress(1)
  return [out]
}
