import { inputClass, toInt } from '../fields.tsx'
import type { PanelProps } from '../panels.ts'
import type { ResizeOptions } from './run.ts'

export const defaultOptions: ResizeOptions = { mode: 'pixels', width: 0, height: 0, percent: 50, keepAspect: true }

export function Panel({ options, onChange }: PanelProps<ResizeOptions>) {
  const set = (patch: Partial<ResizeOptions>) => onChange({ ...options, ...patch })
  const num = (key: 'width' | 'height', label: string) => (
    <label className="flex items-center gap-2 text-sm">
      {label}
      <input
        type="number"
        min={1}
        value={options[key] || ''}
        placeholder={options.keepAspect ? 'auto' : ''}
        onChange={(e) => set({ mode: 'pixels', [key]: toInt(e.target.value) })}
        className={`${inputClass} w-24`}
      />
      px
    </label>
  )
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Resize</legend>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="resize-mode" checked={options.mode === 'pixels'} onChange={() => set({ mode: 'pixels' })} />
          By pixels
        </label>
        {num('width', 'Width')}
        {num('height', 'Height')}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={options.keepAspect} onChange={(e) => set({ keepAspect: e.target.checked })} />
          Keep aspect ratio
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="resize-mode" checked={options.mode === 'percent'} onChange={() => set({ mode: 'percent' })} />
        By percent
        <input
          type="number"
          min={1}
          value={options.percent || ''}
          onChange={(e) => set({ mode: 'percent', percent: toInt(e.target.value) })}
          aria-label="Percent of the original size"
          className={`${inputClass} w-24`}
        />
        %
      </label>
    </fieldset>
  )
}
