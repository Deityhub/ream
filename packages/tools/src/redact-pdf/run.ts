import { UserError, type FileData, type RunContext } from '@ream/core'
import { browserPlatform, displayedArea, redactPdf, type Platform } from '@ream/pdf-render'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'
import { areasFor, pagesToRedact, type RedactPdfOptions } from './areas.ts'

export type { RedactPdfOptions }

/** `platform` decodes JPEG pictures that need wiping (the app's own; tests pass a fake) */
export async function run(files: FileData[], o: RedactPdfOptions, { progress }: RunContext, platform: Platform = browserPlatform): Promise<FileData[]> {
  const doc = await loadPdf(files[0])
  const pages = pagesToRedact(o, doc.pages().length)
  if (!pages.length) throw new UserError('Drag on a page to mark what to redact.')
  const areas = new Map(pages.map((i) => [i, areasFor(o, i).map((r) => displayedArea(doc, i, r))]))
  progress(0.1)
  const bytes = await redactPdf(doc, areas, { platform, hidden: o.hidden })
  progress(1)
  return [pdfFile(`${baseName(files[0].name)}-redacted.pdf`, bytes)]
}
