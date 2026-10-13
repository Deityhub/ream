import type { RunFn } from '@ream/core'

// Engine entry points, loaded on demand. Kept apart from the manifests so the UI bundle never pulls in engine code.
export const runners: Record<string, () => Promise<{ run: RunFn<any> }>> = {
  'merge-pdf': () => import('./merge-pdf/run.ts'),
  'split-pdf': () => import('./split-pdf/run.ts'),
}
