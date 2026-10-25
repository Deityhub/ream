import { Icon } from '@ream/ui'
import type { PanelProps } from '../panels.ts'
import { RangeField, SpotPicker, inputClass } from '../fields.tsx'
import type { WatermarkOptions as O } from './run.ts'

export const defaultOptions: O = { text: 'CONFIDENTIAL', size: 64, bold: true, italic: false, color: '#888888', opacity: 30, angle: 45, layout: 'single', spot: 'mc', spacing: 60, layer: 'over', pages: '', fontFile: null, fontName: '' }

export function Panel({ options, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...options, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Watermark</legend>
      <label className="block space-y-1 text-sm">
        Text
        <input type="text" value={options.text} onChange={(e) => set({ text: e.target.value })} className={`${inputClass} w-full`} />
      </label>
      <div className="space-y-2 text-sm">
        <label className="block space-y-1">
          Font
          <select
            value={options.fontFile ? 'file' : 'builtin'}
            onChange={(e) => (e.target.value === 'builtin' ? set({ fontFile: null, fontName: '' }) : document.getElementById('wm-font-file')?.click())}
            className={`${inputClass} w-full`}
          >
            <option value="builtin">Helvetica (Latin letters)</option>
            <option value="file">{options.fontFile ? options.fontName : 'A font file (.ttf, .otf)…'}</option>
          </select>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 font-medium hover:bg-surface-2 has-focus-visible:outline-2 has-focus-visible:outline-accent">
          <Icon name="upload" className="size-4" />
          {options.fontFile ? 'Choose another font' : 'Choose a font file'}
          <input
            id="wm-font-file"
            type="file"
            accept=".ttf,.otf,.ttc,font/ttf,font/otf"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) set({ fontFile: new Uint8Array(await f.arrayBuffer()), fontName: f.name })
              e.target.value = ''
            }}
          />
        </label>
      </div>
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
      <p className="text-xs text-muted">{options.fontFile ? 'The font must be a TrueType or OpenType file (.ttf, .otf) that allows embedding, and have every letter of the text. Letters are placed one after another with no kerning, so scripts that need shaping (Arabic, Indic) are not supported. Bold and italic use the file\'s own bold and italic when it has them (a .ttc collection can hold several); otherwise the letters are drawn thicker and slanted. ' : 'Helvetica has Latin letters, digits and common symbols; use a font file for other scripts. '}Text behind the page is hidden where the page has a solid background.</p>
    </fieldset>
  )
}
