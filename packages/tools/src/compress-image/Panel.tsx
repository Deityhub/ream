import { RangeField, inputClass } from '../fields.tsx'
import type { PanelProps } from '../panels.ts'
import { COLOR_STEPS, defaultOptions, type CompressOptions as O } from './options.ts'

export { defaultOptions }

export function Panel({ options: o, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  return (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-medium">How much to shrink</legend>
      <div>
        <RangeField label="Quality" value={o.quality} min={10} max={95} onChange={(quality) => set({ quality })} />
        <p className="mt-1 text-xs text-muted">For JPG and WebP. Lower is smaller. Around 75 is hard to tell from the original on most photos.</p>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={o.reduceColors} onChange={(e) => set({ reduceColors: e.target.checked })} />
          Use fewer colours
        </label>
        <label className="flex flex-wrap items-center gap-2 pl-6 text-sm">
          Up to
          <select value={o.colors} disabled={!o.reduceColors} onChange={(e) => set({ colors: Number(e.target.value) })} className={`${inputClass} disabled:opacity-50`}>
            {COLOR_STEPS.map((n) => (
              <option key={n} value={n}>
                {n} colours
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pl-6 text-sm">
          <input type="checkbox" checked={o.dither} disabled={!o.reduceColors} onChange={(e) => set({ dither: e.target.checked })} />
          Smooth gradients (dithering)
        </label>
        <p className="pl-6 text-xs text-muted">For PNG and GIF. Flat graphics and screenshots shrink a lot. Smoothing hides banding in photos but adds noise, so turn it off for the smallest file. PNG is otherwise kept pixel for pixel.</p>
      </div>
      <div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={o.keepMetadata} onChange={(e) => set({ keepMetadata: e.target.checked })} />
          Keep camera details and location (JPG)
        </label>
        <p className="mt-1 pl-6 text-xs text-muted">Off by default: this information is removed, which also makes the file smaller. The colour profile is always kept.</p>
      </div>
    </fieldset>
  )
}
