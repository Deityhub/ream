import type { PanelProps } from '../panels.ts'
import type { RotateOptions } from './run.ts'

export const defaultOptions: RotateOptions = { turns: 1, flipH: false, flipV: false }

const TURNS: { value: RotateOptions['turns']; label: string }[] = [
  { value: 0, label: 'No rotation' },
  { value: 1, label: '90° clockwise' },
  { value: 2, label: '180°' },
  { value: 3, label: '90° counter-clockwise' },
]

export function Panel({ options, onChange }: PanelProps<RotateOptions>) {
  const set = (patch: Partial<RotateOptions>) => onChange({ ...options, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Rotate and flip</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {TURNS.map((t) => (
          <label key={t.value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="rotate-turns" checked={options.turns === t.value} onChange={() => set({ turns: t.value })} />
            {t.label}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={options.flipH} onChange={(e) => set({ flipH: e.target.checked })} />
          Flip horizontally
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={options.flipV} onChange={(e) => set({ flipV: e.target.checked })} />
          Flip vertically
        </label>
      </div>
    </fieldset>
  )
}
