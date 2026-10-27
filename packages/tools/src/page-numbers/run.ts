import type { RunFn } from '@ream/core'
import { baseFont, fontResource, pdfText, stamp, textWidth } from '@ream/pdf-core'
import { baseName, clampInt, loadPdf, pdfFile, rgb, spotCentre, type Spot } from '../pdf-common.ts'

export type PageNumbersOptions = {
  format: 'n' | 'page-n' | 'n-of-total' | 'page-n-of-total'
  spot: Extract<Spot, 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'>
  /** the number shown on the first numbered page */
  start: number
  /** first page to number (1-based); earlier pages are left blank, like a cover */
  from: number
  size: number
  color: string
}

const MARGIN = 28
const CAP_HEIGHT = 0.72

export const label = (format: PageNumbersOptions['format'], n: number, last: number) =>
  ({ n: `${n}`, 'page-n': `Page ${n}`, 'n-of-total': `${n} of ${last}`, 'page-n-of-total': `Page ${n} of ${last}` })[format]

export const run: RunFn<PageNumbersOptions> = async (files, o, { progress }) => {
  const doc = await loadPdf(files[0])
  const count = doc.pages().length
  const from = clampInt(o.from, 1, count)
  const start = clampInt(o.start, 0, 99999)
  const size = clampInt(o.size, 6, 72)
  const last = start + (count - from) // the number on the final page
  const font = {}
  const name = baseFont(font)
  const colour = rgb(o.color)

  const bytes = stamp(doc, (page) => {
    progress((page.index + 1) / page.count)
    if (page.index < from - 1) return null
    const text = label(o.format, start + page.index - (from - 1), last)
    const box = { width: textWidth(text, size, font), height: size * CAP_HEIGHT }
    const [cx, cy] = spotCentre(o.spot, page, box, MARGIN)
    return { content: `${colour} rg\nBT /${fontResource(name)} ${size} Tf ${+(cx - box.width / 2).toFixed(2)} ${+(cy - box.height / 2).toFixed(2)} Td ${pdfText(text)} Tj ET`, fonts: [name] }
  })
  return [pdfFile(`${baseName(files[0].name)}-numbered.pdf`, bytes)]
}
