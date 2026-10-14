import type { PanelProps } from '../panels.ts'
import { RangeField, SpotPicker, inputClass } from '../fields.tsx'
import type { WatermarkOptions as O } from './run.ts'

export const defaultOptions: O = { text: 'CONFIDENTIAL', size: 64, bold: true, italic: false, color: '#888888', opacity: 30, angle: 45, layout: 'single', spot: 'mc', spacing: 60, layer: 'over', pages: '' }

export function Panel({ options, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...options, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Watermark</legend>
      <label className="block space-y-1 text-sm">
        Text
        <input type="text" value={options.text} onChange={(e) => set({ text: e.target.value })} className={`${inputClass} w-full`} />
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          Size
          <input type="number" min={6} max={400} value={options.size} onChange={(e) => set({ size: Number(e.target.value) })} className={`${inputClass} w-20`} />
        </label>
        <label className="flex items-center gap-2">
          Colour
          <input type="color" value={options.color} onChange={(e) => set({ color: e.target.value })} className="h-8 w-10 rounded border border-field bg-surface" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={options.bold} onChange={(e) => set({ bold: e.target.checked })} /> Bold
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={options.italic} onChange={(e) => set({ italic: e.target.checked })} /> Italic
        </label>
      </div>
      <RangeField label="Opacity" value={options.opacity} min={5} max={100} unit="%" onChange={(opacity) => set({ opacity })} />
      <RangeField label="Angle" value={options.angle} min={-90} max={90} step={5} unit="°" onChange={(angle) => set({ angle })} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="watermark-layout" checked={options.layout === 'single'} onChange={() => set({ layout: 'single' })} />
          One stamp
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="watermark-layout" checked={options.layout === 'tile'} onChange={() => set({ layout: 'tile' })} />
          Repeat over the page
        </label>
      </div>
      {options.layout === 'tile' && <RangeField label="Spacing" value={options.spacing} min={0} max={200} step={5} unit=" pt" onChange={(spacing) => set({ spacing })} />}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3 text-sm">
        {options.layout === 'single' && (
          <div className="space-y-1">
            <span className="block">Position</span>
            <SpotPicker label="Position on the page" value={options.spot} onChange={(spot) => set({ spot })} />
          </div>
        )}
        <label className="min-w-0 space-y-1">
          <span className="block">Layer</span>
          <select value={options.layer} onChange={(e) => set({ layer: e.target.value as O['layer'] })} className={inputClass}>
            <option value="over">On top of the page</option>
            <option value="under">Behind the page</option>
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        Pages
        <input type="text" value={options.pages} onChange={(e) => set({ pages: e.target.value })} placeholder="All pages, or like 1-3, 5" className={`${inputClass} w-full`} />
      </label>
      <p className="text-xs text-muted">Letters, digits and common symbols for now. Text behind the page is hidden where the page has a solid background.</p>
    </fieldset>
  )
}
