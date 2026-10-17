import type { PanelProps } from '../panels.ts'
import { inputClass } from '../fields.tsx'
import type { PdfToExcelOptions as O } from './run.ts'

export const defaultOptions: O = { pages: '', layout: 'table', numbers: true }

export function Panel({ options: o, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Workbook</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="xl-layout" checked={o.layout === 'table'} onChange={() => set({ layout: 'table' })} className="mt-1" />
        <span>
          One sheet for each table
          <span className="block text-xs text-muted">Easiest to work with when tables differ.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="xl-layout" checked={o.layout === 'page'} onChange={() => set({ layout: 'page' })} className="mt-1" />
        <span>
          One sheet for each page
          <span className="block text-xs text-muted">Tables on a page sit one under the other.</span>
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={o.numbers} onChange={(e) => set({ numbers: e.target.checked })} />
        Turn amounts and percentages into numbers
      </label>
      <label className="block space-y-1 text-sm">
        Pages
        <input type="text" value={o.pages} onChange={(e) => set({ pages: e.target.value })} placeholder="All pages, or like 1-3, 5" className={`${inputClass} w-full`} />
      </label>
      <p className="text-xs text-muted">Only tables are saved, not the text around them. Tables are found from drawn lines and from text that lines up in columns, so irregular layouts can be missed or split. Dates stay as text. Scans need OCR, which Ream does not have yet.</p>
    </fieldset>
  )
}
