import { UserError, type FileData, type RunFn } from '@ream/core'
import { encodePng } from '@ream/image-core'
import { PdfStream, decodeUntilImage, isDict, isName, type PdfDocument, type PdfObj } from '@ream/pdf-core'
import { browserPlatform, rasterizeImage, type Platform } from '@ream/pdf-render'
import { baseName, loadPdf } from '../pdf-common.ts'

export type ExtractImagesOptions = {
  /** pictures with a side shorter than this many pixels (icons, bullets, rules) are skipped; 0 keeps everything */
  minSize: number
}

/** every image XObject reachable from the resources, directly or through form XObjects, in the order found */
function imagesIn(doc: PdfDocument, resources: PdfObj | undefined, seen: Set<PdfStream>, out: PdfStream[]) {
  const res = doc.resolve(resources)
  const xobjects = isDict(res) ? doc.resolve(res.get('XObject')) : null
  if (!isDict(xobjects)) return
  for (const v of xobjects.values()) {
    const x = doc.resolve(v)
    if (!(x instanceof PdfStream) || seen.has(x)) continue
    seen.add(x)
    const sub = doc.resolve(x.dict.get('Subtype'))
    if (isName(sub, 'Image')) out.push(x)
    else if (isName(sub, 'Form')) imagesIn(doc, x.dict.get('Resources'), seen, out)
  }
}

/** a JPEG is copied out as it is stored; anything else is decoded and saved as PNG (with its transparency) */
export async function extractFrom(doc: PdfDocument, im: PdfStream, platform: Platform): Promise<{ ext: 'jpg' | 'png'; bytes: Uint8Array; width: number; height: number } | 'unsupported'> {
  const num = (k: string) => {
    const v = doc.resolve(im.dict.get(k))
    return typeof v === 'number' ? v : 0
  }
  const { data, rest } = await decodeUntilImage(im)
  if (rest?.filter === 'DCTDecode') return { ext: 'jpg', bytes: data, width: num('Width'), height: num('Height') }
  const raster = await rasterizeImage({ doc, platform, fill: [0, 0, 0], warn: () => {} }, im)
  if (raster === 'unsupported') return 'unsupported'
  return { ext: 'png', bytes: await encodePng({ width: raster.width, height: raster.height, data: raster.rgba }), width: raster.width, height: raster.height }
}

export const run: RunFn<ExtractImagesOptions> = async (files, o, ctx, platform: Platform = browserPlatform) => {
  const doc = await loadPdf(files[0])
  const minSize = Math.max(0, Math.floor(Number(o.minSize)) || 0)
  const base = baseName(files[0].name)
  const seen = new Set<PdfStream>() // a picture used on several pages is saved once, with the first page that shows it
  const pages = doc.pages()
  const found: { page: number; im: PdfStream }[] = []
  for (const [i, page] of pages.entries()) {
    const list: PdfStream[] = []
    imagesIn(doc, page.dict.get('Resources') ?? page.inherited.get('Resources'), seen, list)
    for (const im of list) found.push({ page: i + 1, im })
  }
  if (!found.length) throw new UserError("This PDF doesn't have any pictures in it. (Drawings and text aren't pictures.)")

  const out: FileData[] = []
  const perPage = new Map<number, number>()
  let unsupported = 0
  let small = 0
  for (const [n, { page, im }] of found.entries()) {
    ctx.progress(n / found.length)
    const w = doc.resolve(im.dict.get('Width'))
    const h = doc.resolve(im.dict.get('Height'))
    if (typeof w === 'number' && typeof h === 'number' && Math.min(w, h) < minSize) {
      small++
      continue
    }
    const got = await extractFrom(doc, im, platform)
    if (got === 'unsupported') {
      unsupported++
      continue
    }
    const k = (perPage.get(page) ?? 0) + 1
    perPage.set(page, k)
    out.push({ name: `${base}-page${page}-image${k}.${got.ext}`, type: got.ext === 'jpg' ? 'image/jpeg' : 'image/png', bytes: got.bytes })
  }
  ctx.progress(1)
  if (!out.length) {
    const why = [small && `${small} ${small === 1 ? 'was' : 'were'} smaller than ${minSize} pixels`, unsupported && `${unsupported} ${unsupported === 1 ? 'uses' : 'use'} a format Ream can't read yet (scans in fax or JPEG 2000 form)`].filter(Boolean).join(' and ')
    throw new UserError(`No pictures could be extracted: ${why}.`)
  }
  return out
}
