import type { PanelProps } from '../panels.ts'
import { RangeField } from '../fields.tsx'
import { NONE, PRESETS, presetOf, presetValues, type FilterOptions as O } from './presets.ts'

export const defaultOptions: O = NONE

const SLIDERS: { key: keyof O; label: string; min: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -100 },
  { key: 'contrast', label: 'Contrast', min: -100 },
  { key: 'saturation', label: 'Colour', min: -100 },
  { key: 'warmth', label: 'Warmth', min: -100 },
  { key: 'sepia', label: 'Sepia', min: 0 },
  { key: 'vignette', label: 'Vignette', min: 0 },
  { key: 'blur', label: 'Blur', min: 0 },
  { key: 'sharpen', label: 'Sharpen', min: 0 },
]

export function Panel({ options: o, onChange }: PanelProps<O>) {
  const look = presetOf(o)
  return (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-medium">Filters</legend>
      <div role="group" aria-label="Looks" className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={look === p.id}
            onClick={() => onChange(presetValues(p.id))}
            className={`border px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:py-2.5 ${look === p.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {SLIDERS.map((s) => (
          <RangeField key={s.key} label={s.label} value={o[s.key]} min={s.min} max={100} onChange={(v) => onChange({ ...o, [s.key]: v })} />
        ))}
      </div>
      <p className="text-xs text-muted">Every picture you add gets the same filters. Colours are adjusted as they are stored, not as a camera would.</p>
    </fieldset>
  )
}
