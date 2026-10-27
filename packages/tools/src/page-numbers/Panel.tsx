import type { PanelProps } from '../panels.ts'
import { SpotPicker, inputClass } from '../fields.tsx'
import type { PageNumbersOptions as O } from './run.ts'

export const defaultOptions: O = { format: 'n', spot: 'bc', start: 1, from: 1, size: 11, color: '#000000' }

const FORMATS: { value: O['format']; label: string }[] = [
  { value: 'n', label: '1, 2, 3' },
  { value: 'page-n', label: 'Page 1, Page 2' },
  { value: 'n-of-total', label: '1 of 10, 2 of 10' },
  { value: 'page-n-of-total', label: 'Page 1 of 10' },
]

export function Panel({ options, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...options, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Page numbers</legend>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Format
        <select value={options.format} onChange={(e) => set({ format: e.target.value as O['format'] })} className={inputClass}>
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </label>
      <div className="space-y-1 text-sm">
        <span className="block">Position</span>
        <SpotPicker label="Position on the page" value={options.spot} onChange={(spot) => set({ spot: spot as O['spot'] })} allowed={['tl', 'tc', 'tr', 'bl', 'bc', 'br']} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          Start at
          <input type="number" min={0} value={options.start} onChange={(e) => set({ start: Number(e.target.value) })} className={`${inputClass} w-20`} />
        </label>
        <label className="flex items-center gap-2">
          From page
          <input type="number" min={1} value={options.from} onChange={(e) => set({ from: Number(e.target.value) })} className={`${inputClass} w-20`} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          Size
          <input type="number" min={6} max={72} value={options.size} onChange={(e) => set({ size: Number(e.target.value) })} className={`${inputClass} w-20`} />
        </label>
        <label className="flex items-center gap-2">
          Colour
          <input type="color" value={options.color} onChange={(e) => set({ color: e.target.value })} className="h-8 w-10 rounded border border-field bg-surface" />
        </label>
      </div>
      <p className="text-xs text-muted">Pages before "From page" stay unnumbered, so a cover page can be skipped.</p>
    </fieldset>
  )
}
