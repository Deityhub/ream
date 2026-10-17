import type { PanelProps } from '../panels.ts'
import { inputClass } from '../fields.tsx'
import type { PdfToImageOptions as O } from './run.ts'

export const defaultOptions: O = { pages: '', format: 'png', dpi: 150, quality: 90 }

const DPI: [number, string][] = [
  [72, '72 dpi (screen)'],
  [150, '150 dpi (reading)'],
  [200, '200 dpi (sharp)'],
  [300, '300 dpi (print)'],
]

export function Panel({ options: o, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Pictures</legend>
      <label className="block space-y-1 text-sm">
        Pages
        <input type="text" value={o.pages} onChange={(e) => set({ pages: e.target.value })} placeholder="All pages, or like 1-3, 5" className={`${inputClass} w-full`} />
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-sm">
        <label className="flex items-center gap-2">
          Save as
          <select value={o.format} onChange={(e) => set({ format: e.target.value as O['format'] })} className={inputClass}>
            <option value="png">PNG</option>
            <option value="jpg">JPG</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Resolution
          <select value={o.dpi} onChange={(e) => set({ dpi: Number(e.target.value) })} className={inputClass}>
            {DPI.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {o.format === 'jpg' && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Quality
          <input type="range" min={40} max={100} value={o.quality} onChange={(e) => set({ quality: Number(e.target.value) })} />
          <span className="w-8 text-muted">{o.quality}</span>
        </label>
      )}
      <p className="text-xs text-muted">Several pages are saved together in a ZIP. Pages are drawn by Ream's own renderer, so fonts that are not stored in the PDF are shown in similar ones.</p>
    </fieldset>
  )
}
