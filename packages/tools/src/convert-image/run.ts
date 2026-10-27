import type { FileData, RunFn } from '@ream/core'
import type { OutputMime } from '@ream/image-core'
import { decodeFile, encodeFile, outName } from '../image-common.ts'
import { outputFormat } from '../image-formats.ts'

export type ConvertOptions = { format: OutputMime; quality: number }

export const run: RunFn<ConvertOptions> = async (files, { format, quality }, { progress }) => {
  const fmt = outputFormat(format)
  const outputs: FileData[] = []
  for (const [i, f] of files.entries()) {
    outputs.push(await encodeFile(await decodeFile(f), fmt, quality, outName(f.name, '', fmt)))
    progress((i + 1) / files.length)
  }
  return outputs
}
