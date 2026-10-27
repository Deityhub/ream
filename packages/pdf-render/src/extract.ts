import type { PdfDocument } from '@ream/pdf-core'
import { pageChars, type TextChar } from './textchars.ts'
import { bodySizeOf, layoutPage } from './textlayout.ts'

export type ExtractOptions = { markdown: boolean }

const SAMPLE = 30 // pages whose type sizes decide what counts as body text

/** the text of each of the given pages (0-based), in the same order; '' for a page with no text */
export async function extractText(doc: PdfDocument, pages: number[], o: ExtractOptions, progress: (done: number) => void = () => {}): Promise<string[]> {
  const out: string[] = []
  let body = 0
  const first: TextChar[][] = []
  if (o.markdown) {
    const sizes = new Map<number, number>()
    for (const p of pages.slice(0, SAMPLE)) {
      const { chars } = await pageChars(doc, p)
      first.push(chars)
      bodySizeOf(chars, sizes)
    }
    body = bodySizeOf([], sizes)
  }
  for (const [i, p] of pages.entries()) {
    const chars = first[i] ?? (await pageChars(doc, p)).chars
    out.push(layoutPage(chars, { markdown: o.markdown, bodySize: body || undefined }))
    first[i] = []
    progress((i + 1) / pages.length)
  }
  return out
}
