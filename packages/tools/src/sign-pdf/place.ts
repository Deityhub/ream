// Where a signature goes. Plain functions (no React) so the panel, the run and the tests share them.
import { UserError } from '@ream/core'
import type { Rect } from '../rect.ts'

export type SignPdfOptions = {
  /** the signature as a PNG with transparency; null until one is made */
  image: Uint8Array | null
  /** 'page': the one in `page`; 'last' and 'all' as they say */
  scope: 'page' | 'last' | 'all'
  /** 0-based, for scope 'page' */
  page: number
  /** the box the signature sits in, as fractions of the page as displayed; the picture is fitted inside it */
  rect: Rect
}

export const defaultRect: Rect = { x: 0.55, y: 0.8, w: 0.35, h: 0.12 }
export const defaultOptions: SignPdfOptions = { image: null, scope: 'last', page: 0, rect: defaultRect }

export function pagesToSign(o: Pick<SignPdfOptions, 'scope' | 'page'>, count: number): number[] {
  if (o.scope === 'all') return Array.from({ length: count }, (_, i) => i)
  if (o.scope === 'last') return [count - 1]
  if (o.page < 0 || o.page >= count) throw new UserError(`There is no page ${o.page + 1} in this PDF.`)
  return [o.page]
}

/** the picture's box in points on a page of this displayed size (origin bottom left): as big as fits in `rect`, centred in it */
export function fitInside(rect: Rect, aspect: number, page: { width: number; height: number }): { x: number; y: number; w: number; h: number } {
  const [bw, bh] = [rect.w * page.width, rect.h * page.height]
  const [w, h] = bw / bh > aspect ? [bh * aspect, bh] : [bw, bw / aspect]
  const x = rect.x * page.width + (bw - w) / 2
  // the rectangle's y counts from the top, PDF's from the bottom
  const y = page.height - (rect.y * page.height + bh) + (bh - h) / 2
  return { x, y, w, h }
}
