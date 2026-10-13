import type { RunFn } from '@ream/core'
import { chunks, parseRanges, split } from '@ream/pdf-core'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'

export type SplitOptions = { mode: 'ranges' | 'every'; ranges: string; every: number }

export const run: RunFn<SplitOptions> = async (files, options, { progress }) => {
  const doc = await loadPdf(files[0])
  const count = doc.pages().length
  const groups = options.mode === 'every' ? chunks(count, options.every) : parseRanges(options.ranges, count)
  const base = baseName(files[0].name)
  const outputs = []
  for (const [i, group] of groups.entries()) {
    outputs.push(pdfFile(`${base}-${i + 1}.pdf`, split(doc, [group])[0]))
    progress((i + 1) / groups.length)
  }
  return outputs
}
