import type { PanelProps } from '../panels.ts'
import { inputClass } from '../fields.tsx'
import type { PdfToTextOptions as O } from './run.ts'

export const defaultOptions: O = { format: 'text', pages: '' }

export function Panel({ options: o, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Text</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="text-format" checked={o.format === 'text'} onChange={() => set({ format: 'text' })} className="mt-1" />
        <span>
          Plain text
          <span className="block text-xs text-muted">Lines as they are on the page, a blank line between paragraphs.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="text-format" checked={o.format === 'markdown'} onChange={() => set({ format: 'markdown' })} className="mt-1" />
        <span>
          Markdown
          <span className="block text-xs text-muted">Headings from type size, lists, bold and italic, paragraphs joined.</span>
        </span>
      </label>
      <label className="block space-y-1 text-sm">
        Pages
        <input type="text" value={o.pages} onChange={(e) => set({ pages: e.target.value })} placeholder="All pages, or like 1-3, 5" className={`${inputClass} w-full`} />
      </label>
      <p className="text-xs text-muted">Reading order is worked out from where the text sits, so simple pages and columns read well and tables come out as lines. Pages that are pictures (scans) have no text to get: that needs OCR.</p>
    </fieldset>
  )
}
