import { PdfName, PdfStream, decodeUntilImage, isDict, type PdfDict, type PdfDocument, type PdfObj } from '@ream/pdf-core'
import { loadColorSpace, type ColorSpace, type RGB } from './color.ts'
import { numbers } from './function.ts'
import type { Platform } from './platform.ts'

export type Raster = { width: number; height: number; rgba: Uint8ClampedArray }

export type ImageEnv = {
  doc: PdfDocument
  platform: Platform
  resources?: PdfDict
  /** colour that stencil masks paint with */
  fill: RGB
  warn: (message: string) => void
}

const num = (o: PdfObj | undefined) => (typeof o === 'number' ? o : undefined)

/** read one sample of `bpc` bits starting at bit offset `bit` of `row` */
function read(row: Uint8Array, bit: number, bpc: number): number {
  if (bpc === 8) return row[bit >> 3] ?? 0
  if (bpc === 16) return ((row[bit >> 3] ?? 0) << 8) | (row[(bit >> 3) + 1] ?? 0)
  return ((row[bit >> 3] ?? 0) >> (8 - bpc - (bit & 7))) & ((1 << bpc) - 1)
}

/** stencil: painted where the sample is 0 (with the default Decode), in the given colour */
function stencil(data: Uint8Array, width: number, height: number, invert: boolean, [r, g, b]: RGB): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4)
  const rowBytes = (width + 7) >> 3
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * rowBytes, (y + 1) * rowBytes)
    for (let x = 0; x < width; x++) {
      const bit = read(row, x, 1)
      if ((bit === 1) === invert) {
        const o = (y * width + x) * 4
        rgba[o] = r
        rgba[o + 1] = g
        rgba[o + 2] = b
        rgba[o + 3] = 255
      }
    }
  }
  return { width, height, rgba }
}

/** raw samples to RGBA through the colour space (and the optional colour-key mask) */
export function samplesToRaster(
  data: Uint8Array,
  width: number,
  height: number,
  bpc: number,
  cs: ColorSpace,
  decode: number[] | null,
  colorKey: number[] | null,
): Raster {
  const rgba = new Uint8ClampedArray(width * height * 4)
  const n = cs.n
  const rowBytes = (width * n * bpc + 7) >> 3
  const max = 2 ** bpc - 1
  const defaultDecode = cs.name === 'Indexed' ? [0, max] : cs.range ? cs.range.flat() : cs.initial.flatMap(() => [0, 1])
  const dec = decode && decode.length >= 2 * n ? decode : defaultDecode
  const plain = dec.every((v, i) => v === defaultDecode[i]) && !colorKey

  // fast paths for the common 8-bit cases
  if (plain && bpc === 8 && cs.name === 'DeviceRGB') {
    for (let i = 0, o = 0; i < width * height; i++, o += 4) {
      rgba[o] = data[i * 3] ?? 0
      rgba[o + 1] = data[i * 3 + 1] ?? 0
      rgba[o + 2] = data[i * 3 + 2] ?? 0
      rgba[o + 3] = 255
    }
    return { width, height, rgba }
  }
  if (plain && bpc === 8 && cs.name === 'DeviceGray') {
    for (let i = 0, o = 0; i < width * height; i++, o += 4) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = data[i] ?? 0
      rgba[o + 3] = 255
    }
    return { width, height, rgba }
  }
  // palettes: work out every colour once
  if (cs.name === 'Indexed' && bpc <= 8 && !colorKey) {
    const palette = Array.from({ length: max + 1 }, (_, i) => cs.rgb([dec[0] + (i * (dec[1] - dec[0])) / max]))
    for (let y = 0; y < height; y++) {
      const row = data.subarray(y * rowBytes, (y + 1) * rowBytes)
      for (let x = 0; x < width; x++) {
        const c = palette[read(row, x * bpc, bpc)]
        const o = (y * width + x) * 4
        rgba[o] = c[0]
        rgba[o + 1] = c[1]
        rgba[o + 2] = c[2]
        rgba[o + 3] = 255
      }
    }
    return { width, height, rgba }
  }

  // anything else, one pixel at a time
  const comps = new Array<number>(n)
  const raw = new Array<number>(n)
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * rowBytes, (y + 1) * rowBytes)
    for (let x = 0; x < width; x++) {
      let keyed = !!colorKey
      for (let k = 0; k < n; k++) {
        const v = read(row, (x * n + k) * bpc, bpc)
        raw[k] = v
        comps[k] = dec[2 * k] + (v * (dec[2 * k + 1] - dec[2 * k])) / max
        if (colorKey && (v < colorKey[2 * k] || v > colorKey[2 * k + 1])) keyed = false
      }
      const c = cs.rgb(comps)
      const o = (y * width + x) * 4
      rgba[o] = c[0]
      rgba[o + 1] = c[1]
      rgba[o + 2] = c[2]
      rgba[o + 3] = keyed ? 0 : 255
    }
  }
  return { width, height, rgba }
}

/** nearest-neighbour resample of the alpha channel of `mask` (its red channel) onto an image of w x h */
function applyAlpha(image: Raster, mask: Raster, fromRed: boolean) {
  for (let y = 0; y < image.height; y++) {
    const my = Math.min(mask.height - 1, Math.floor((y * mask.height) / image.height))
    for (let x = 0; x < image.width; x++) {
      const mx = Math.min(mask.width - 1, Math.floor((x * mask.width) / image.width))
      const m = (my * mask.width + mx) * 4
      image.rgba[(y * image.width + x) * 4 + 3] = fromRed ? mask.rgba[m] : mask.rgba[m + 3]
    }
  }
}

/**
 * Decode an image XObject or inline image to RGBA. Returns 'unsupported' for kinds we can't decode yet (JPEG 2000,
 * JBIG2, CCITT fax), so the caller can mark where the picture goes.
 */
export async function rasterizeImage(env: ImageEnv, stream: PdfStream): Promise<Raster | 'unsupported'> {
  const { doc } = env
  const get = (k: string, short?: string) => doc.resolve(stream.dict.get(k) ?? (short ? stream.dict.get(short) : undefined))
  let width = num(get('Width', 'W')) ?? 0
  let height = num(get('Height', 'H')) ?? 0
  const isMask = get('ImageMask', 'IM') === true
  const decode = numbers(doc, stream.dict.get('Decode') ?? stream.dict.get('D'))
  const bpc = isMask ? 1 : (num(get('BitsPerComponent', 'BPC')) ?? 8)

  const { data, rest } = await decodeUntilImage(stream)
  let image: Raster

  if (rest) {
    if (rest.filter !== 'DCTDecode' && rest.filter !== 'DCT') {
      env.warn(`${rest.filter.replace('Decode', '')} images aren't drawn yet`)
      return 'unsupported'
    }
    try {
      image = await env.platform.decodeJpeg(data)
    } catch {
      env.warn("A JPEG image couldn't be decoded")
      return 'unsupported'
    }
  } else if (isMask) {
    if (width < 1 || height < 1) return 'unsupported'
    image = stencil(data, width, height, !!decode && decode[0] === 1, env.fill)
  } else {
    if (width < 1 || height < 1) return 'unsupported'
    const cs = await loadColorSpace(doc, stream.dict.get('ColorSpace') ?? stream.dict.get('CS'), env.resources)
    const key = numbers(doc, stream.dict.get('Mask'))
    image = samplesToRaster(data, width, height, bpc, cs, decode, key && key.length >= 2 * cs.n ? key : null)
  }
  ;({ width, height } = image)

  // soft mask (gray image as alpha) or explicit stencil mask
  const smask = doc.resolve(stream.dict.get('SMask'))
  const explicit = doc.resolve(stream.dict.get('Mask'))
  if (smask instanceof PdfStream) {
    const m = await rasterizeImage(env, new PdfStream(new Map([...smask.dict, ['ColorSpace', new PdfName('DeviceGray')]]), smask.data))
    if (m !== 'unsupported') applyAlpha(image, m, true)
  } else if (explicit instanceof PdfStream && isDict(explicit.dict)) {
    const mw = num(doc.resolve(explicit.dict.get('Width'))) ?? 0
    const mh = num(doc.resolve(explicit.dict.get('Height'))) ?? 0
    const md = numbers(doc, explicit.dict.get('Decode'))
    const { data: mdata } = await decodeUntilImage(explicit)
    if (mw > 0 && mh > 0) applyAlpha(image, stencil(mdata, mw, mh, !!md && md[0] === 1, [0, 0, 0]), false)
  }
  return image
}
