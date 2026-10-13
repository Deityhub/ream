import { DEFAULT_QUALITY } from '../image-formats.ts'
import { FormatFields } from '../fields.tsx'
import type { PanelProps } from '../panels.ts'
import type { ConvertOptions } from './run.ts'

export const defaultOptions: ConvertOptions = { format: 'image/jpeg', quality: DEFAULT_QUALITY }

export function Panel({ options, onChange }: PanelProps<ConvertOptions>) {
  return <FormatFields {...options} onChange={(patch) => onChange({ ...options, ...patch })} />
}
