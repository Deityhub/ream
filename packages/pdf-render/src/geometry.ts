import type { Page, PdfDocument } from '@ream/pdf-core'
import { numbers } from './function.ts'
import { pageMatrix, type Matrix } from './matrix.ts'

/** the page's visible box [llx, lly, urx, ury]: the crop box if it has one, else the media box */
export function pageBox(doc: PdfDocument, page: Page): [number, number, number, number] {
  const get = (k: string) => numbers(doc, page.dict.get(k) ?? page.inherited.get(k))
  const b = [get('CropBox'), get('MediaBox')].find((x) => x && x.length === 4) ?? [0, 0, 612, 792]
  return [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])]
}

/** user space of the page to the page as displayed (y down, rotation applied), `scale` pixels per point */
export function pageBase(doc: PdfDocument, page: Page, scale: number): Matrix {
  const rotate = doc.resolve(page.dict.get('Rotate') ?? page.inherited.get('Rotate'))
  return pageMatrix(pageBox(doc, page), typeof rotate === 'number' ? rotate : 0, scale)
}
