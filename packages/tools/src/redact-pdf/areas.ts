// Options of Redact PDF, shared by the panel and the run (no engine code here).
import type { Rect } from '../rect.ts'

export type RedactPdfOptions = {
  /** 'all': the same areas on every page; 'page': each page its own (pages without any are left alone) */
  scope: 'all' | 'page'
  areas: Rect[]
  areasByPage: Record<number, Rect[]>
  /** also remove the document properties, XMP metadata, thumbnails and private application data */
  hidden: boolean
}

export const defaultOptions: RedactPdfOptions = { scope: 'page', areas: [], areasByPage: {}, hidden: true }

/** the areas of one page */
export const areasFor = (o: RedactPdfOptions, index: number): Rect[] => (o.scope === 'all' ? o.areas : (o.areasByPage[index] ?? []))

/** the pages that get redacted */
export const pagesToRedact = (o: RedactPdfOptions, count: number) => Array.from({ length: count }, (_, i) => i).filter((i) => areasFor(o, i).length > 0)
