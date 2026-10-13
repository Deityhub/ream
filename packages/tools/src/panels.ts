import type { ComponentType } from 'react'

/** `files` are the inputs chosen so far, for panels that preview them (crop) */
export type PanelProps<O = any> = { options: O; onChange: (options: O) => void; files: File[] }
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
}
