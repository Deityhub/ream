import type { ComponentType } from 'react'
import type { MetadataSummary } from '@ream/image-core'

/** what a PDF options panel can ask the app for: page sizes and a drawn page (the app owns the worker that renders them) */
export type PdfHost = {
  pages(file: File): Promise<{ width: number; height: number }[]>
  PdfPage: ComponentType<{ file: Blob; page: number; renderWidth: number }>
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
  pdfHost?: PdfHost
}
export type PanelModule = { Panel: ComponentType<PanelProps<any>>; defaultOptions: unknown }

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
  metadata: () => import('./metadata/Panel.tsx'),
  'extract-images': () => import('./extract-images/Panel.tsx'),
  'compress-image': () => import('./compress-image/Panel.tsx'),
  'animated-gif': () => import('./animated-gif/Panel.tsx'),
  'image-metadata': () => import('./image-metadata/Panel.tsx'),
  'compress-pdf': () => import('./compress-pdf/Panel.tsx'),
}
