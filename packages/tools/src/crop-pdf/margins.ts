import { UserError } from '@ream/core'
import { WHOLE, isWhole, type Rect } from '../rect.ts'

/** what to keep, as fractions of each page as displayed; and what to do with the rest */
export type CropPdfOptions = {
  /** 'all': one selection for every page. 'page': each page has its own selection, pages without one are left alone. */
  scope: 'all' | 'page'
  rect: Rect
  rects: Record<number, Rect>
  /** delete what is cropped out (default) instead of only hiding it */
  remove: boolean
}

export const defaultOptions: CropPdfOptions = { scope: 'all', rect: WHOLE, rects: {}, remove: true }

/** the selection for a page (0-based), or null when that page is not to be cropped */
export function rectFor(o: CropPdfOptions, index: number): Rect | null {
  const r = o.scope === 'all' ? o.rect : o.rects[index]
  return r && !isWhole(r) ? r : null
}

/** the pages that will be cropped */
export const pagesToCrop = (o: CropPdfOptions, count: number) => Array.from({ length: count }, (_, i) => i).filter((i) => rectFor(o, i))

/** displayed margins in points (top, right, bottom, left) that leave exactly the selection on a page of this displayed size */
export function marginsOf(r: Rect, page: { width: number; height: number }): [number, number, number, number] {
  return [r.y * page.height, (1 - r.x - r.w) * page.width, (1 - r.y - r.h) * page.height, r.x * page.width]
}

export const NOTHING = new UserError('Drag on the page to choose the area to keep.')
