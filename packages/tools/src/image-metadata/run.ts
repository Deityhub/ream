import { UserError, type FileData, type RunFn } from '@ream/core'
import { cleanImageMetadata } from '@ream/image-core'
import { baseName } from '../names.ts'
import type { ImageMetadataOptions } from './options.ts'

export type { ImageMetadataOptions }

export const run: RunFn<ImageMetadataOptions> = async (files, { mode }, { progress }) => {
  const outputs: FileData[] = []
  for (const [i, f] of files.entries()) {
    const png = f.type === 'image/png'
    if (!png && f.type !== 'image/jpeg') throw new UserError(`${f.name}: only JPG and PNG files can be cleaned.`)
    // the pixels are never decoded or re-encoded, so the picture stays exactly as it was
    outputs.push({ name: `${baseName(f.name)}-clean.${png ? 'png' : 'jpg'}`, type: f.type, bytes: cleanImageMetadata(f.bytes, mode) })
    progress((i + 1) / files.length)
  }
  return outputs
}
