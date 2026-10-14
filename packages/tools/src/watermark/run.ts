import { UserError, type RunFn } from '@ream/core'
import { baseFont, fontResource, pdfText, stamp, textWidth } from '@ream/pdf-core'
import { baseName, clampInt, loadPdf, pdfFile, rgb, selectPages, spotCentre, type Spot } from '../pdf-common.ts'

export type WatermarkOptions = {
  text: string
  size: number
  bold: boolean
  italic: boolean
  color: string
  /** 1..100 */
  opacity: number
  /** degrees, counter-clockwise */
  angle: number
  spot: Spot
  layer: 'over' | 'under'
  /** page ranges like 1-3,5; empty for every page */
  pages: string
}

const EDGE = 36 // points between an edge spot and the page edge
const CAP_HEIGHT = 0.72 // of the font size, Helvetica

export const run: RunFn<WatermarkOptions> = async (files, o, { progress }) => {
  const text = o.text.trim()
  if (!text) throw new UserError('Enter the watermark text.')
  const doc = await loadPdf(files[0])
  const only = selectPages(o.pages, doc.pages().length)
  const font = { bold: o.bold, italic: o.italic }
  const name = baseFont(font)
  const size = clampInt(o.size, 6, 400)
  const angle = ((Math.round(Number(o.angle)) || 0) * Math.PI) / 180
  const [cos, sin] = [+Math.cos(angle).toFixed(5), +Math.sin(angle).toFixed(5)]
  const colour = rgb(o.color)
  const string = pdfText(text)
  const box = { width: textWidth(text, size, font), height: size * CAP_HEIGHT }

  const bytes = stamp(doc, (page) => {
    progress((page.index + 1) / page.count)
    if (only && !only.has(page.index)) return null
    const [cx, cy] = spotCentre(o.spot, page, box, EDGE)
    return {
      // move to the text's centre, turn, then draw it centred on that point
      content: `${colour} rg\nq 1 0 0 1 ${+cx.toFixed(2)} ${+cy.toFixed(2)} cm ${cos} ${sin} ${-sin} ${cos} 0 0 cm\nBT /${fontResource(name)} ${size} Tf ${+(-box.width / 2).toFixed(2)} ${+(-box.height / 2).toFixed(2)} Td ${string} Tj ET\nQ`,
      fonts: [name],
      alpha: clampInt(o.opacity, 1, 100) / 100,
      under: o.layer === 'under',
    }
  })
  return [pdfFile(`${baseName(files[0].name)}-watermarked.pdf`, bytes)]
}
