import { UserError, type RunFn } from '@ream/core'
import { baseFont, embeddedResource, fontFaces, fontResource, parseTtf, pdfText, prepareFont, stamp, textWidth, type FontFaceInfo } from '@ream/pdf-core'
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
  /** a TrueType or OpenType font to draw the text with, instead of Helvetica: lets it be in any script the font has. Bold and italic use its own faces when it has them (`faceFor`), else are drawn. */
  fontFile: Uint8Array | null
  /** the file's name, for the panel */
  fontName: string
}

const EDGE = 36 // points between an edge spot and the page edge
const CAP_HEIGHT = 0.72 // of the font size, Helvetica
const MAX_COPIES = 2000 // per page, so a tiny size with no spacing can't produce a huge file
const BOLD_STROKE = 0.03 // of the font size: the outline that thickens a face with no bold of its own
const SLANT = 0.2126 // tan 12°, the skew that slants a face with no italic of its own

const boldStyle = /bold|black|heavy/i
const italicStyle = /italic|oblique/i
const plainStyle = /^(regular|roman|book|normal|bold|italic|oblique|bold (italic|oblique))$/i

/**
 * Which face of a font file to draw with, and what of bold and italic it lacks, to be drawn instead. A collection
 * (.ttc) can hold the real bold or italic; a face that already is bold or italic needs nothing added; otherwise the
 * face closest to plain is thickened and slanted, as word processors do. A face that is bold when bold isn't wanted
 * stays bold: there is nothing to take away.
 */
export function faceFor(faces: FontFaceInfo[], bold: boolean, italic: boolean): { face: string | number; fakeBold: boolean; fakeItalic: boolean } {
  const traits = (f: FontFaceInfo) => [boldStyle.test(f.style), italicStyle.test(f.style)]
  // faces with nothing unwanted, the one with most of what is wanted first (a real bold beats a drawn one), and among
  // those the face named just for it: "Regular" or "Bold" before "Medium", "Demi Bold" or "Condensed Bold"
  const rank = (f: FontFaceInfo) => traits(f).filter(Boolean).length * 2 + (plainStyle.test(f.style.trim()) ? 1 : 0)
  const fits = faces.filter((f) => f.embeddable && (bold || !traits(f)[0]) && (italic || !traits(f)[1]))
  const face = fits.sort((x, y) => rank(y) - rank(x))[0] ?? faces[0]
  const [b, i] = face ? traits(face) : [false, false]
  return { face: face?.postscript ?? 0, fakeBold: bold && !b, fakeItalic: italic && !i }
}

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
  // an uploaded font is cut down to this text's glyphs and embedded; otherwise Helvetica, which every viewer has
  const pick = o.fontFile ? faceFor(fontFaces(o.fontFile), o.bold, o.italic) : null
  const embedded = o.fontFile ? await prepareFont(parseTtf(o.fontFile, pick!.face), text) : null
  const string = embedded ? embedded.encode(text) : pdfText(text)
  const resource = embedded ? embeddedResource('Wm') : fontResource(name)
  const stroke = pick?.fakeBold ? +(size * BOLD_STROKE).toFixed(2) : 0
  const slant = pick?.fakeItalic ? SLANT : 0
  const capHeight = embedded ? embedded.capHeight(size) : size * CAP_HEIGHT
  // the outline grows each letter by half its width on every side, and the slant pushes the top right
  const box = { width: (embedded ? embedded.width(text, size) : textWidth(text, size, font)) + stroke + capHeight * slant, height: capHeight + stroke }
  // drawn bold: fill and stroke the letters in the same colour, with round joins so corners don't spike
  const look = stroke ? `2 Tr ${stroke} w 1 j ${colour} RG ` : ''

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
    const shows = copies.map(([x, y]) => `1 0 ${slant} 1 ${+(x - box.width / 2).toFixed(2)} ${+(y - box.height / 2).toFixed(2)} Tm ${string} Tj`).join('\n')
    return {
      // move to the frame's centre, turn, then draw each copy centred on its spot
      content: `${colour} rg\nq 1 0 0 1 ${+ox.toFixed(2)} ${+oy.toFixed(2)} cm ${cos} ${sin} ${-sin} ${cos} 0 0 cm\nBT /${resource} ${size} Tf ${look}\n${shows}\nET\nQ`,
      ...(embedded ? { embedded: { Wm: embedded } } : { fonts: [name] }),
      alpha: clampInt(o.opacity, 1, 100) / 100,
      under: o.layer === 'under',
    }
  })
  return [pdfFile(`${baseName(files[0].name)}-watermarked.pdf`, bytes)]
}
