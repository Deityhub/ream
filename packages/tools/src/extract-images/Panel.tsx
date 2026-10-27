import type { PanelProps } from '../panels.ts'
import { inputClass } from '../fields.tsx'
import type { ExtractImagesOptions as O } from './run.ts'

export const defaultOptions: O = { minSize: 32 }

export function Panel({ options, onChange }: PanelProps<O>) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Pictures to save</legend>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Skip pictures smaller than
        <input type="number" min={0} value={options.minSize} onChange={(e) => onChange({ minSize: Number(e.target.value) })} className={`${inputClass} w-20`} />
        px
      </label>
      <p className="text-xs text-muted">JPG pictures are saved exactly as stored in the PDF. Others are saved as PNG. Set 0 to keep tiny icons too.</p>
    </fieldset>
  )
}
