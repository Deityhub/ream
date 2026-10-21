import type { ComponentType, ReactNode } from 'react'
import type { MetadataSummary } from '@ream/image-core'
import type { FormInfo, OutlineItem } from '@ream/pdf-core'
import type { PageLayout } from './edit-pdf/detect.ts'
import type { PageContent } from './edit-pdf/content.ts'

/** what a PDF options panel can ask the app for: page sizes and a drawn page (the app owns the worker that renders them) */
export type PdfHost = {
  pages(file: File): Promise<{ width: number; height: number }[]>
  /** the bookmarks of a PDF (0-based pages) */
  outline(file: File): Promise<OutlineItem[]>
  /** the form fields with every place they are shown */
  form(file: File): Promise<FormInfo>
  /** the letters of a page with their boxes, as fractions of the page as displayed (y from the top) */
  chars?(file: File, page: number): Promise<{ text: string; x0: number; y0: number; x1: number; y1: number }[]>
  /** a page's letters and ruled lines in points, for finding where form fields go */
  layout?(file: File, page: number): Promise<PageLayout>
  /** a page's own lines of text and pictures, as fractions of the page, for editing them */
  content?(file: File, page: number): Promise<PageContent>
  /** whether the file opens normally: it can be read, how many pages it has, and whether its index had to be rebuilt to read it */
  check(file: File): Promise<{ ok: boolean; pages: number; rebuilt: boolean; message?: string }>
  PdfPage: ComponentType<{ file: Blob; page: number; renderWidth: number; fields?: boolean }>
  /** like PdfPage but it reserves the page's space first and only draws once it scrolls near the screen (for long grids) */
  LazyPage: ComponentType<{ file: Blob; page: number; size: { width: number; height: number }; renderWidth: number }>
}

/** `files` are the inputs chosen so far, for panels that preview them (crop) */
export type PanelProps<O = any> = {
  options: O
  onChange: (options: O) => void
  files: File[]
  /** the document information of a PDF, read off the main thread (for the metadata tool) */
  readMetadata?: (file: File) => Promise<Record<string, string>>
  /** what a JPEG or PNG says about itself, read off the main thread (for the image metadata tool) */
  readImageMetadata?: (file: File) => Promise<MetadataSummary | null>
  /** the font names a .pptx or .xlsx uses, read off the main thread (for the Office converters' installed-font option) */
  readOfficeFonts?: (file: File) => Promise<string[]>
  /** the faces in a font file someone added (a web font comes back unpacked) */
  readFontFile?: (file: Blob) => Promise<{ faces: { family: string; typographic?: string; style: string; postscript: string; embeddable: boolean }[]; bytes: Uint8Array }>
  pdfHost?: PdfHost
  /** the run button with its progress and hints. A panel that sets `placesActions` puts it where it wants (next to its controls); otherwise the page shows it under the panel */
  actions?: ReactNode
}
export type PanelModule = { Panel: ComponentType<PanelProps<any>>; defaultOptions: unknown; placesActions?: boolean }

// Options UI per tool, loaded on demand.
export const panels: Record<string, () => Promise<PanelModule>> = {
  'merge-pdf': () => import('./merge-pdf/Panel.tsx'),
  'split-pdf': () => import('./split-pdf/Panel.tsx'),
  'resize-image': () => import('./resize-image/Panel.tsx'),
  'convert-image': () => import('./convert-image/Panel.tsx'),
  'rotate-image': () => import('./rotate-image/Panel.tsx'),
  'crop-image': () => import('./crop-image/Panel.tsx'),
  'merge-images': () => import('./merge-images/Panel.tsx'),
  'images-to-pdf': () => import('./images-to-pdf/Panel.tsx'),
  watermark: () => import('./watermark/Panel.tsx'),
  'page-numbers': () => import('./page-numbers/Panel.tsx'),
  'crop-pdf': () => import('./crop-pdf/Panel.tsx'),
  'redact-pdf': () => import('./redact-pdf/Panel.tsx'),
  'fill-pdf-form': () => import('./fill-pdf-form/Panel.tsx'),
  'edit-pdf': () => import('./edit-pdf/Panel.tsx'),
  metadata: () => import('./metadata/Panel.tsx'),
  'extract-images': () => import('./extract-images/Panel.tsx'),
  'compress-image': () => import('./compress-image/Panel.tsx'),
  'animated-gif': () => import('./animated-gif/Panel.tsx'),
  'image-metadata': () => import('./image-metadata/Panel.tsx'),
  'compress-pdf': () => import('./compress-pdf/Panel.tsx'),
  'protect-pdf': () => import('./protect-pdf/Panel.tsx'),
  'unlock-pdf': () => import('./unlock-pdf/Panel.tsx'),
  'sign-pdf': () => import('./sign-pdf/Panel.tsx'),
  'watermark-image': () => import('./watermark-image/Panel.tsx'),
  'blur-image': () => import('./blur-image/Panel.tsx'),
  'filters-image': () => import('./filters-image/Panel.tsx'),
  'meme': () => import('./meme/Panel.tsx'),
  'bookmarks-pdf': () => import('./bookmarks-pdf/Panel.tsx'),
  'organize-pdf': () => import('./organize-pdf/Panel.tsx'),
  'repair-pdf': () => import('./repair-pdf/Panel.tsx'),
  'pdf-to-text': () => import('./pdf-to-text/Panel.tsx'),
  'pdf-to-image': () => import('./pdf-to-image/Panel.tsx'),
  'pdf-to-excel': () => import('./pdf-to-excel/Panel.tsx'),
  'pdf-to-word': () => import('./pdf-to-word/Panel.tsx'),
  'pdf-to-powerpoint': () => import('./pdf-to-powerpoint/Panel.tsx'),
  'powerpoint-to-pdf': () => import('./powerpoint-to-pdf/Panel.tsx'),
  'excel-to-pdf': () => import('./excel-to-pdf/Panel.tsx'),
}
