import { UserError, type FileData, type RunFn } from '@ream/core'
import { resize } from '@ream/image-core'
import { decodeFile, encodeFile, outName } from '../image-common.ts'
import { DEFAULT_QUALITY, formatFor } from '../image-formats.ts'

export type ResizeOptions = {
  mode: 'pixels' | 'percent'
  /** 0 means "not set" */
  width: number
  height: number
  percent: number
  keepAspect: boolean
}

export function computeSize(w0: number, h0: number, o: ResizeOptions): [number, number] {
  const round = (n: number) => Math.max(1, Math.round(n))
  if (o.mode === 'percent') {
    if (!(o.percent > 0)) throw new UserError('Enter a percentage above 0.')
    return [round((w0 * o.percent) / 100), round((h0 * o.percent) / 100)]
  }
  const w = o.width > 0 ? o.width : 0
  const h = o.height > 0 ? o.height : 0
  if (!o.keepAspect) {
    if (!w || !h) throw new UserError('Enter both a width and a height, or keep the aspect ratio.')
    return [w, h]
  }
  if (!w && !h) throw new UserError('Enter a width or a height.')
  // with both set, the image is fitted inside that box
  const scale = w && h ? Math.min(w / w0, h / h0) : w ? w / w0 : h / h0
  return [round(w0 * scale), round(h0 * scale)]
}

export const run: RunFn<ResizeOptions> = async (files, options, { progress }) => {
  const outputs: FileData[] = []
  for (const [i, f] of files.entries()) {
    const img = await decodeFile(f)
    const [w, h] = computeSize(img.width, img.height, options)
    const fmt = formatFor(f.type)
    outputs.push(await encodeFile(resize(img, w, h), fmt, DEFAULT_QUALITY, outName(f.name, '-resized', fmt)))
    progress((i + 1) / files.length)
  }
  return outputs
}
