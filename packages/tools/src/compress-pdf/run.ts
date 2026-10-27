import { UserError, type FileData, type RunContext } from '@ream/core'
import { PdfStream, isName, optimize } from '@ream/pdf-core'
import { browserPlatform, imagePlacements, type Platform } from '@ream/pdf-render'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'
import { recompressImage } from './images.ts'
import { LEVELS, type CompressPdfOptions } from './options.ts'

export type { CompressPdfOptions }

/** `platform` decodes colour photos (the browser's decoder; where it can't, as in Node tests, ours is used) */
export async function run(files: FileData[], { level }: CompressPdfOptions, { progress }: RunContext, platform: Platform | undefined = browserPlatform): Promise<FileData[]> {
  const plan = LEVELS[level]
  if (!plan) throw new UserError('Choose how much to compress.')
  const f = files[0]
  const doc = await loadPdf(f)
  const replace = new Map<PdfStream, PdfStream>()
  if (plan.quality > 0) {
    const images = [...doc.objects.values()].filter((o): o is PdfStream => o instanceof PdfStream && isName(doc.resolve(o.dict.get('Subtype')), 'Image'))
    if (images.length) {
      // how big each picture is shown on the pages decides how much of it to keep
      const placed = await imagePlacements(doc)
      progress(0.3)
      for (const [i, im] of images.entries()) {
        try {
          const smaller = await recompressImage(doc, im, placed.get(im), plan, platform)
          if (smaller) replace.set(im, smaller)
        } catch {
          // a picture that can't be redone stays as it is
        }
        progress(0.3 + (0.6 * (i + 1)) / images.length)
      }
    }
  }
  const bytes = await optimize(doc, { replace })
  progress(1)
  // a file that was already as small as it gets stays as it was
  return [pdfFile(`${baseName(f.name)}-compressed.pdf`, bytes.length < f.bytes.length ? bytes : f.bytes)]
}
