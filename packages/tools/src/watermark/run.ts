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
  /** one stamp at `spot`, or the text repeated over the whole page */
  layout: 'single' | 'tile'
  spot: Spot
  /** tile only: points of space between copies */
  spacing: number
  layer: 'over' | 'under'
  /** page ranges like 1-3,5; empty for every page */
  pages: string
}

const EDGE = 36 // points between an edge spot and the page edge
const CAP_HEIGHT = 0.72 // of the font size, Helvetica
const MAX_COPIES = 2000 // per page, so a tiny size with no spacing can't produce a huge file

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

  const tile = o.layout === 'tile'
  const gap = clampInt(o.spacing, 0, 200)
  // half the extent of one rotated copy, for deciding whether it touches the page
  const [hx, hy] = [(Math.abs(cos) * box.width + Math.abs(sin) * box.height) / 2, (Math.abs(sin) * box.width + Math.abs(cos) * box.height) / 2]

  const bytes = stamp(doc, (page) => {
    progress((page.index + 1) / page.count)
    if (only && !only.has(page.index)) return null
    // copies are placed in a frame turned by the angle; (ox, oy) is where that frame's centre sits on the page
    const [ox, oy] = tile ? [page.width / 2, page.height / 2] : spotCentre(o.spot, page, box, EDGE)
    const copies: [number, number][] = [[0, 0]]
    if (tile) {
      copies.length = 0
      // brick pattern: every other row is shifted half a copy, which reads as a mosaic rather than a grid
      const [px, py] = [box.width + gap, box.height + gap]
      const reach = Math.hypot(page.width, page.height) / 2 + Math.hypot(box.width, box.height) / 2
      for (let j = -Math.ceil(reach / py); j <= Math.ceil(reach / py); j++) {
        for (let i = -Math.ceil(reach / px) - 1; i <= Math.ceil(reach / px) + 1; i++) {
          const x = i * px + (j & 1 ? px / 2 : 0)
          const y = j * py
          const [X, Y] = [x * cos - y * sin, x * sin + y * cos]
          if (Math.abs(X) <= page.width / 2 + hx && Math.abs(Y) <= page.height / 2 + hy) copies.push([x, y])
        }
      }
      if (copies.length > MAX_COPIES) throw new UserError('The spacing is too small for this text size, which would repeat it too many times. Increase the spacing or the size.')
    }
    const shows = copies.map(([x, y]) => `1 0 0 1 ${+(x - box.width / 2).toFixed(2)} ${+(y - box.height / 2).toFixed(2)} Tm ${string} Tj`).join('\n')
    return {
      // move to the frame's centre, turn, then draw each copy centred on its spot
      content: `${colour} rg\nq 1 0 0 1 ${+ox.toFixed(2)} ${+oy.toFixed(2)} cm ${cos} ${sin} ${-sin} ${cos} 0 0 cm\nBT /${fontResource(name)} ${size} Tf\n${shows}\nET\nQ`,
      fonts: [name],
      alpha: clampInt(o.opacity, 1, 100) / 100,
      under: o.layer === 'under',
    }
  })
  return [pdfFile(`${baseName(files[0].name)}-watermarked.pdf`, bytes)]
}
