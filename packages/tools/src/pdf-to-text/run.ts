import { UserError, type RunFn } from '@ream/core'
import { extractText } from '@ream/pdf-render'
import { baseName, loadPdf, selectPages } from '../pdf-common.ts'

export type PdfToTextOptions = {
  format: 'text' | 'markdown'
  /** like "1-3, 5"; empty for every page */
  pages: string
}

export const run: RunFn<PdfToTextOptions> = async (files, o, { progress }) => {
  const f = files[0]
  const doc = await loadPdf(f)
  const count = doc.pages().length
  const chosen = selectPages(o.pages, count)
  const pages = chosen ? [...chosen].sort((a, b) => a - b) : Array.from({ length: count }, (_, i) => i)
  const markdown = o.format === 'markdown'
  const texts = await extractText(doc, pages, { markdown }, progress)
  const kept = texts.filter((t) => t.trim())
  if (!kept.length) {
    throw new UserError(
      pages.length === 1
        ? 'No text was found on this page. If it is a scan or a photo, the page is a picture and reading text out of a picture needs OCR, which Ream does not have yet.'
        : 'No text was found. If this PDF is a scan or made of photos, its pages are pictures, and reading text out of pictures needs OCR, which Ream does not have yet.',
    )
  }
  const text = kept.join(markdown ? '\n\n---\n\n' : '\n\n') + '\n'
  return [{ name: `${baseName(f.name)}.${markdown ? 'md' : 'txt'}`, type: markdown ? 'text/markdown' : 'text/plain', bytes: new TextEncoder().encode(text) }]
}
