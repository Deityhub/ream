// Saving a PDF's pictures smaller: JPEGs and photographic pictures are decoded, brought down to the resolution they are
// shown at, and saved as JPEG again. Anything this can't be sure about is left exactly as it is.
import { deflate } from '@ream/core'
import { PdfStream, decodeUntilImage, isName, name, type PdfDocument, type PdfObj } from '@ream/pdf-core'
import { createImage, decodeJpeg, encodeJpeg, pngFilterRows, resize, type ImageBuffer } from '@ream/image-core'
import type { Placement } from '@ream/pdf-render'

export type ImagePlan = {
  /** 1 to 100 */
  quality: number
  /** dots per inch to bring pictures down to; 0 keeps their size */
  dpi: number
}

const num = (doc: PdfDocument, o: PdfObj | undefined) => {
  const v = doc.resolve(o)
  return typeof v === 'number' ? v : undefined
}

/** how many colour components the picture has, when it is something a JPEG holds as it is: grey or RGB, plain or through an ICC profile */
function components(doc: PdfDocument, cs: PdfObj | undefined): 1 | 3 | null {
  const v = doc.resolve(cs)
  if (isName(v, 'DeviceGray') || isName(v, 'DeviceRGB')) return v.value === 'DeviceGray' ? 1 : 3
  if (Array.isArray(v)) {
    const kind = doc.resolve(v[0])
    if (isName(kind, 'CalGray')) return 1
    if (isName(kind, 'CalRGB')) return 3
    if (isName(kind, 'ICCBased')) {
      const profile = doc.resolve(v[1])
      const n = profile instanceof PdfStream ? num(doc, profile.dict.get('N')) : undefined
      return n === 1 || n === 3 ? n : null
    }
  }
  return null
}

/**
 * A photograph (or a scan, whose noise is spread over every shade) as opposed to a chart, a screenshot or anti-aliased text:
 * JPEG helps the first and blurs the second. Colour: thousands of distinct colours. Grey (a grey scan, or colour with no
 * colour in it) has only 256 shades, so it counts how many of them hold a real share of the pixels (text is nearly all
 * white and black, with a thin ramp between).
 */
export function looksPhotographic(img: ImageBuffer): boolean {
  const step = Math.max(1, Math.floor((img.width * img.height) / 40000))
  const samples = Math.ceil((img.width * img.height) / step)
  let grey = true
  for (let i = 0; i < img.width * img.height && grey; i += step) grey = img.data[i * 4] === img.data[i * 4 + 1] && img.data[i * 4] === img.data[i * 4 + 2]
  if (grey) {
    const levels = new Uint32Array(256)
    for (let i = 0; i < img.width * img.height; i += step) levels[img.data[i * 4]]++
    return levels.filter((n) => n >= samples * 0.001).length >= 48
  }
  const colours = new Set<number>()
  for (let i = 0; i < img.width * img.height; i += step) {
    const p = i * 4
    colours.add((img.data[p] << 16) | (img.data[p + 1] << 8) | img.data[p + 2])
    if (colours.size > 3000) return true
  }
  return false
}

/** the pixels as stored samples again (grey or RGB), compressed with Flate and PNG prediction */
async function flateSamples(img: ImageBuffer, n: 1 | 3): Promise<Uint8Array> {
  const raw = new Uint8Array(img.width * img.height * n)
  for (let i = 0; i < img.width * img.height; i++) for (let c = 0; c < n; c++) raw[i * n + c] = img.data[i * 4 + c]
  return deflate(pngFilterRows(raw, img.width * n, img.height, n, [0, 1, 2, 3, 4]))
}

/** the picture saved smaller, or null when it should stay as it is (including when there is nothing to gain) */
export async function recompressImage(doc: PdfDocument, im: PdfStream, placed: Placement | undefined, plan: ImagePlan): Promise<PdfStream | null> {
  const d = im.dict
  if (!isName(doc.resolve(d.get('Subtype')), 'Image')) return null
  // stencils, colour-key masks and unusual decode ranges rely on exact sample values
  if (doc.resolve(d.get('ImageMask')) === true || d.has('Mask') || d.has('Decode')) return null
  const w = num(doc, d.get('Width'))
  const h = num(doc, d.get('Height'))
  if (!w || !h || (num(doc, d.get('BitsPerComponent')) ?? 8) !== 8) return null
  const n = components(doc, d.get('ColorSpace'))
  if (!n) return null
  const smask = doc.resolve(d.get('SMask'))
  if (smask instanceof PdfStream && smask.dict.has('Matte')) return null // premultiplied against a matte colour

  let dec
  try {
    dec = await decodeUntilImage(im)
  } catch {
    return null
  }
  let pixels: ImageBuffer
  let wasJpeg = false
  if (dec.rest) {
    if (dec.rest.filter !== 'DCTDecode' && dec.rest.filter !== 'DCT') return null // JPEG 2000, CCITT, JBIG2: not ours
    const j = decodeJpeg(dec.data)
    if (j.components !== n) return null
    pixels = j
    wasJpeg = true
  } else {
    if (dec.data.length < w * h * n) return null
    pixels = createImage(w, h)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      pixels.data[o] = dec.data[i * n]
      pixels.data[o + 1] = dec.data[i * n + (n === 3 ? 1 : 0)]
      pixels.data[o + 2] = dec.data[i * n + (n === 3 ? 2 : 0)]
      pixels.data[o + 3] = 255
    }
  }
  if (pixels.width !== w || pixels.height !== h) return null // the file disagrees with itself

  // the size it is shown at decides how many pixels are worth keeping
  let nw = w
  let nh = h
  if (plan.dpi > 0 && placed && placed.width > 0 && placed.height > 0) {
    const dpiX = w / (placed.width / 72)
    const dpiY = h / (placed.height / 72)
    // a small excess isn't worth a resample
    if (dpiX > plan.dpi * 1.15) nw = Math.max(8, Math.round((w * plan.dpi) / dpiX))
    if (dpiY > plan.dpi * 1.15) nh = Math.max(8, Math.round((h * plan.dpi) / dpiY))
    nw = Math.min(nw, w)
    nh = Math.min(nh, h)
  }
  const resized = nw !== w || nh !== h
  const photo = wasJpeg || looksPhotographic(pixels)
  // a picture that is neither photographic nor too sharp has nothing to gain
  if (!photo && !resized) return null
  if (resized) pixels = resize(pixels, nw, nh)

  const dict = new Map(d)
  for (const k of ['Filter', 'F', 'DecodeParms', 'DP', 'Length']) dict.delete(k)
  dict.set('Width', nw)
  dict.set('Height', nh)
  dict.set('BitsPerComponent', 8)
  if (photo) {
    const bytes = encodeJpeg(pixels, { quality: plan.quality, grey: n === 1 })
    // saving a JPEG again at a similar size only costs quality
    if (bytes.length >= im.data.length * (resized || !wasJpeg ? 1 : 0.9)) return null
    dict.set('Filter', name('DCTDecode'))
    return new PdfStream(dict, bytes)
  }
  // line art and text stay lossless: only fewer pixels, stored with Flate and PNG prediction
  const bytes = await flateSamples(pixels, n)
  if (bytes.length >= im.data.length) return null
  dict.set('Filter', name('FlateDecode'))
  dict.set('DecodeParms', new Map<string, PdfObj>([['Predictor', 15], ['Colors', n], ['Columns', nw], ['BitsPerComponent', 8]]))
  return new PdfStream(dict, bytes)
}
