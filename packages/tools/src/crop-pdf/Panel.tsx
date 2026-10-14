import type { PanelProps } from '../panels.ts'
import { inputClass } from '../fields.tsx'
import type { CropPdfOptions as O } from './run.ts'

export const defaultOptions: O = { unit: 'mm', top: 10, right: 10, bottom: 10, left: 10 }

const SIDES: { key: 'top' | 'right' | 'bottom' | 'left'; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'right', label: 'Right' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
]

export function Panel({ options, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...options, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Trim from each edge</legend>
      <div className="grid grid-cols-2 gap-3">
        {SIDES.map((s) => (
          <label key={s.key} className="flex items-center gap-2 text-sm">
            <span className="w-12">{s.label}</span>
            <input type="number" min={0} step="any" value={options[s.key]} onChange={(e) => set({ [s.key]: Number(e.target.value) })} className={`${inputClass} w-full min-w-0`} />
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        Unit
        <select value={options.unit} onChange={(e) => set({ unit: e.target.value as O['unit'] })} className={inputClass}>
          <option value="mm">Millimetres</option>
          <option value="in">Inches</option>
          <option value="pt">Points</option>
          <option value="%">Percent of the page</option>
        </select>
      </label>
      <p className="text-xs text-muted">The same trim is applied to every page. The trimmed part is hidden, not deleted, so it is still in the file.</p>
    </fieldset>
  )
}
