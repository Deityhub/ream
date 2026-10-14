import type { RunFn } from '@ream/core'

// Engine entry points, loaded on demand. Kept apart from the manifests so the UI bundle never pulls in engine code.
export const runners: Record<string, () => Promise<{ run: RunFn<any> }>> = {
  'merge-pdf': () => import('./merge-pdf/run.ts'),
  'split-pdf': () => import('./split-pdf/run.ts'),
  'resize-image': () => import('./resize-image/run.ts'),
  'convert-image': () => import('./convert-image/run.ts'),
  'rotate-image': () => import('./rotate-image/run.ts'),
  'crop-image': () => import('./crop-image/run.ts'),
  'merge-images': () => import('./merge-images/run.ts'),
  'images-to-pdf': () => import('./images-to-pdf/run.ts'),
  watermark: () => import('./watermark/run.ts'),
  'page-numbers': () => import('./page-numbers/run.ts'),
  'crop-pdf': () => import('./crop-pdf/run.ts'),
  metadata: () => import('./metadata/run.ts'),
  'extract-images': () => import('./extract-images/run.ts'),
}
