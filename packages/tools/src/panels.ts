import type { ComponentType } from 'react'

export type PanelProps<O = any> = { options: O; onChange: (options: O) => void }
export type PanelModule = { Panel: ComponentType<PanelProps<any>>; defaultOptions: unknown }

// Options UI per tool, loaded on demand.
export const panels: Record<string, () => Promise<PanelModule>> = {
  'merge-pdf': () => import('./merge-pdf/Panel.tsx'),
  'split-pdf': () => import('./split-pdf/Panel.tsx'),
}
