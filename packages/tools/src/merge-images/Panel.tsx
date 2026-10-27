import { DEFAULT_QUALITY } from '../image-formats.ts'
import { FormatFields, inputClass, toInt } from '../fields.tsx'
import type { PanelProps } from '../panels.ts'
import type { MergeImagesOptions } from './run.ts'

export const defaultOptions: MergeImagesOptions = {
  direction: 'horizontal',
  columns: 2,
  gap: 0,
  background: 'white',
  format: 'image/png',
  quality: DEFAULT_QUALITY,
}

const DIRECTIONS: { value: MergeImagesOptions['direction']; label: string }[] = [
  { value: 'horizontal', label: 'Side by side' },
  { value: 'vertical', label: 'Stacked' },
  { value: 'grid', label: 'Grid' },
]

export function Panel({ options, onChange }: PanelProps<MergeImagesOptions>) {
  const set = (patch: Partial<MergeImagesOptions>) => onChange({ ...options, ...patch })
  return (
    <div className="space-y-4">
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Layout</legend>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {DIRECTIONS.map((d) => (
            <label key={d.value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="merge-direction" checked={options.direction === d.value} onChange={() => set({ direction: d.value })} />
              {d.label}
            </label>
          ))}
          {options.direction === 'grid' && (
            <label className="flex items-center gap-2 text-sm">
              Columns
              <input type="number" min={1} value={options.columns || ''} onChange={(e) => set({ columns: toInt(e.target.value) || 1 })} className={`${inputClass} w-20`} />
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Space between
            <input type="number" min={0} value={options.gap} onChange={(e) => set({ gap: toInt(e.target.value) })} className={`${inputClass} w-20`} />
            px
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Background
            <select value={options.background} onChange={(e) => set({ background: e.target.value as MergeImagesOptions['background'] })} className={inputClass}>
              <option value="white">White</option>
              <option value="transparent">Transparent</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-muted">Images are made the same height or width without enlarging any of them. Use the arrows above to set the order. A transparent background needs PNG or WebP.</p>
      </fieldset>
      <FormatFields format={options.format} quality={options.quality} onChange={set} />
    </div>
  )
}
