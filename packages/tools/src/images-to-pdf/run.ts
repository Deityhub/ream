import type { FileData, RunFn } from '@ream/core'
import { codec, type ImageBuffer } from '@ream/image-core'
import { imagesToPdf, jpegInfo, type ImageInput } from '@ream/pdf-core'
import { pdfFile } from '../pdf-common.ts'
import { decodeFile } from '../image-common.ts'
import { baseName } from '../names.ts'

export type ImagesToPdfOptions = {
  size: 'fit' | 'a4' | 'letter'
  orientation: 'auto' | 'portrait' | 'landscape'
  margin: 'none' | 'small' | 'big'
}

const SIZES = { a4: [595, 842], letter: [612, 792] } as const
const MARGINS = { none: 0, small: 18, big: 36 } as const

const raw = (img: ImageBuffer): ImageInput => ({ width: img.width, height: img.height, rgba: img.data })

/** A JPEG goes in untouched. If it is stored sideways (EXIF) or can't be embedded as is, it is decoded (which turns it upright) and saved again. */
async function toInput(f: FileData): Promise<ImageInput> {
  const info = f.type === 'image/jpeg' ? jpegInfo(f.bytes) : null
  if (info && info.orientation === 1) return { width: info.width, height: info.height, jpeg: f.bytes, components: info.components, adobe: info.adobe }
  const img = await decodeFile(f)
  if (info) {
    try {
      const bytes = await codec().encode(img, 'image/jpeg', 0.92)
      const again = jpegInfo(bytes)
      if (again) return { width: again.width, height: again.height, jpeg: bytes, components: again.components, adobe: again.adobe }
    } catch {
      // this codec can't write JPEG; the pixels go in raw instead
    }
  }
  return raw(img)
}

export const run: RunFn<ImagesToPdfOptions> = async (files, options, { progress }) => {
  const inputs: ImageInput[] = []
  for (const [i, f] of files.entries()) {
    inputs.push(await toInput(f))
    progress((i + 1) / (files.length * 2))
  }
  const bytes = await imagesToPdf(
    inputs,
    { size: options.size === 'fit' ? 'fit' : [...SIZES[options.size]], orientation: options.orientation, margin: MARGINS[options.margin] },
    (done) => progress(0.5 + done / (files.length * 2)),
  )
  return [pdfFile(files.length === 1 ? `${baseName(files[0].name)}.pdf` : 'images.pdf', bytes)]
}
