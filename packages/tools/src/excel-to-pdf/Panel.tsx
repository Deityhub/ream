import { Icon } from '@ream/ui'
import type { PanelProps } from '../panels.ts'
import { inputClass } from '../fields.tsx'
import { PAGE_SIZES } from '../images-to-pdf/sizes.ts'
import type { ExcelToPdfOptions as O } from './run.ts'

export const defaultOptions: O = { paper: 'a4', orientation: 'auto', fit: 'width', gridlines: false, fontFile: null, fontName: '' }

export function Panel({ options: o, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Pages</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-sm">
        <label className="flex items-center gap-2">
          Paper
          <select value={o.paper} onChange={(e) => set({ paper: e.target.value as O['paper'] })} className={inputClass}>
            {Object.entries(PAGE_SIZES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Direction
          <select value={o.orientation} onChange={(e) => set({ orientation: e.target.value as O['orientation'] })} className={inputClass}>
            <option value="auto">Automatic</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={o.fit === 'width'} onChange={(e) => set({ fit: e.target.checked ? 'width' : 'none' })} className="mt-1" />
        <span>
          Fit to page width
          <span className="block text-xs text-muted">Shrinks a wide sheet so all its columns are on one page. Off keeps the real size and continues on more pages.</span>
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={o.gridlines} onChange={(e) => set({ gridlines: e.target.checked })} />
        Print grid lines
      </label>
      <div className="space-y-2 text-sm">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 font-medium hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
          <Icon name="upload" className="size-4" />
          {o.fontFile ? `Font: ${o.fontName}` : 'Choose a font file (optional)'}
          <input
            type="file"
            accept=".ttf,.ttc,font/ttf"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) set({ fontFile: new Uint8Array(await f.arrayBuffer()), fontName: f.name })
              e.target.value = ''
            }}
          />
        </label>
        {o.fontFile && (
          <button type="button" className="ml-2 text-xs text-accent underline" onClick={() => set({ fontFile: null, fontName: '' })}>
            Use the standard fonts
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        Fonts become Helvetica, Times or Courier by name; letters those do not have (other scripts, some symbols) show as ?. A font file (.ttf) that has them is used for every cell instead. Charts, pictures and conditional formatting are not drawn, and formulas show the value saved in the file.
      </p>
    </fieldset>
  )
}
