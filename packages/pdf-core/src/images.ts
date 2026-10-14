// Building a PDF from pictures: a JPEG goes in as it is (no re-encoding, no quality loss), anything else as raw
// pixels compressed with Flate, with transparency kept as a soft mask.
import { PdfRef, PdfStream, PdfString, name, type PdfObj } from './objects.ts'
import { PdfBuilder } from './writer.ts'
import { PdfRangeError } from './errors.ts'
import { deflate } from './flate.ts'
import { ascii } from './bytes.ts'

export type JpegInfo = {
  width: number
  height: number
  components: 1 | 3 | 4
  /** EXIF orientation 1..8 (1 = upright); anything else means a viewer would turn the picture */
  orientation: number
  /** an Adobe marker is present: four-component files from Photoshop store CMYK inverted */
  adobe: boolean
}

/** the facts about a JPEG needed to embed it, or null when it can't go in as is (not a JPEG, 12-bit, lossless, arithmetic) */
export function jpegInfo(b: Uint8Array): JpegInfo | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let orientation = 1
  let adobe = false
  let i = 2
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null
    const m = b[i + 1]
    if (m === 0xff) {
      i++ // fill byte
      continue
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
      i += 2
      continue
    }
    const len = (b[i + 2] << 8) | b[i + 3]
    const seg = i + 4
    if (m === 0xe1 && len >= 14 && b[seg] === 0x45 && b[seg + 1] === 0x78 && b[seg + 2] === 0x69 && b[seg + 3] === 0x66) orientation = exifOrientation(b, seg + 6, i + 2 + len)
    if (m === 0xee && len >= 7 && b[seg] === 0x41 && b[seg + 1] === 0x64 && b[seg + 2] === 0x6f && b[seg + 3] === 0x62 && b[seg + 4] === 0x65) adobe = true
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      const [precision, height, width, n] = [b[seg], (b[seg + 1] << 8) | b[seg + 2], (b[seg + 3] << 8) | b[seg + 4], b[seg + 5]]
      if (precision !== 8 || !width || !height || (n !== 1 && n !== 3 && n !== 4)) return null
      return { width, height, components: n, orientation, adobe }
    }
    if ((m >= 0xc3 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) || m === 0xda) return null
    i += 2 + len
  }
  return null
}

/** the orientation tag (0x0112) of an EXIF block starting at its TIFF header, or 1 when absent or unreadable */
function exifOrientation(b: Uint8Array, tiff: number, end: number): number {
  const le = b[tiff] === 0x49
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1])
  const u32 = (o: number) => (le ? (u16(o) | (u16(o + 2) << 16)) >>> 0 : ((u16(o) << 16) | u16(o + 2)) >>> 0)
  if (tiff + 8 > end || (b[tiff] !== 0x49 && b[tiff] !== 0x4d)) return 1
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > end) return 1
  const count = u16(ifd)
  for (let k = 0; k < count && ifd + 2 + k * 12 + 12 <= end; k++) {
    const e = ifd + 2 + k * 12
    if (u16(e) === 0x0112) {
      const v = u16(e + 8)
      return v >= 1 && v <= 8 ? v : 1
    }
  }
  return 1
}

export type ImageInput = { width: number; height: number } & (
  | { jpeg: Uint8Array; components: 1 | 3 | 4; adobe: boolean }
  | { rgba: Uint8ClampedArray }
)

export type PageSetup = {
  /** 'fit' makes every page as big as its picture; otherwise a fixed size in points (portrait) */
  size: 'fit' | [number, number]
  orientation: 'auto' | 'portrait' | 'landscape'
  /** points of white around the picture */
  margin: number
}

const MAX_PAGE = 14400 // the PDF limit, 200 inches
const CS = { 1: 'DeviceGray', 3: 'DeviceRGB', 4: 'DeviceCMYK' } as const

async function addImage(b: PdfBuilder, img: ImageInput): Promise<PdfRef> {
  const dict = new Map<string, PdfObj>([['Type', name('XObject')], ['Subtype', name('Image')], ['Width', img.width], ['Height', img.height], ['BitsPerComponent', 8]])
  if ('jpeg' in img) {
    dict.set('ColorSpace', name(CS[img.components]))
    dict.set('Filter', name('DCTDecode'))
    if (img.components === 4 && img.adobe) dict.set('Decode', [1, 0, 1, 0, 1, 0, 1, 0])
    return b.add(new PdfStream(dict, img.jpeg))
  }
  const n = img.width * img.height
  const rgb = new Uint8Array(n * 3)
  const alpha = new Uint8Array(n)
  let see = false
  for (let p = 0, q = 0; p < n; p++, q += 4) {
    rgb[p * 3] = img.rgba[q]
    rgb[p * 3 + 1] = img.rgba[q + 1]
    rgb[p * 3 + 2] = img.rgba[q + 2]
    alpha[p] = img.rgba[q + 3]
    if (alpha[p] !== 255) see = true
  }
  dict.set('ColorSpace', name('DeviceRGB'))
  dict.set('Filter', name('FlateDecode'))
  if (see) {
    const mask = new Map<string, PdfObj>([['Type', name('XObject')], ['Subtype', name('Image')], ['Width', img.width], ['Height', img.height], ['ColorSpace', name('DeviceGray')], ['BitsPerComponent', 8], ['Filter', name('FlateDecode')]])
    dict.set('SMask', b.add(new PdfStream(mask, await deflate(alpha))))
  }
  return b.add(new PdfStream(dict, await deflate(rgb)))
}

/** one page per picture, in the order given */
export async function imagesToPdf(images: ImageInput[], setup: PageSetup, onPage?: (done: number) => void): Promise<Uint8Array> {
  if (!images.length) throw new PdfRangeError('Add at least one image.')
  const b = new PdfBuilder()
  const catalog = b.reserve()
  const pages = b.reserve()
  const kids: PdfRef[] = []
  for (const [i, img] of images.entries()) {
    const ref = await addImage(b, img)
    let [pw, ph] = [0, 0]
    if (setup.size === 'fit') {
      // 96 pixels to the inch, the way browsers size a picture
      const k = Math.min(0.75, (MAX_PAGE - 2 * setup.margin) / Math.max(img.width, img.height))
      ;[pw, ph] = [img.width * k + 2 * setup.margin, img.height * k + 2 * setup.margin]
    } else {
      const [short, long] = [Math.min(...setup.size), Math.max(...setup.size)]
      const landscape = setup.orientation === 'landscape' || (setup.orientation === 'auto' && img.width > img.height)
      ;[pw, ph] = landscape ? [long, short] : [short, long]
    }
    const [aw, ah] = [pw - 2 * setup.margin, ph - 2 * setup.margin]
    if (setup.size !== 'fit' && (aw < 1 || ah < 1)) throw new PdfRangeError('The margin is too big for this page size.')
    const s = Math.min(aw / img.width, ah / img.height)
    const [w, h] = [img.width * s, img.height * s]
    const [x, y] = [(pw - w) / 2, (ph - h) / 2]
    const content = b.add(new PdfStream(new Map(), ascii(`q ${w} 0 0 ${h} ${x} ${y} cm /Im0 Do Q\n`)))
    kids.push(
      b.add(
        new Map<string, PdfObj>([
          ['Type', name('Page')], ['Parent', pages], ['MediaBox', [0, 0, pw, ph]], ['Contents', content],
          ['Resources', new Map<string, PdfObj>([['XObject', new Map<string, PdfObj>([['Im0', ref]])]])],
        ]),
      ),
    )
    onPage?.(i + 1)
  }
  b.set(pages, new Map<string, PdfObj>([['Type', name('Pages')], ['Kids', kids], ['Count', kids.length]]))
  b.set(catalog, new Map<string, PdfObj>([['Type', name('Catalog')], ['Pages', pages]]))
  const info = b.add(new Map<string, PdfObj>([['Producer', new PdfString(ascii('Ream'))]]))
  return b.serialize(catalog, info)
}
