import type { PanelProps } from '../panels.ts'
import { inputClass } from '../fields.tsx'
import type { PdfToWordOptions as O } from './run.ts'

export const defaultOptions: O = { pages: '', mode: 'editable', dpi: 150 }

export function Panel({ options: o, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Document</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="word-mode" checked={o.mode === 'editable'} onChange={() => set({ mode: 'editable' })} className="mt-1" />
        <span>
          Editable text
          <span className="block text-xs text-muted">Paragraphs, headings, lists, tables and pictures you can change. The layout is close, not exact.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="word-mode" checked={o.mode === 'picture'} onChange={() => set({ mode: 'picture' })} className="mt-1" />
        <span>
          Page pictures
          <span className="block text-xs text-muted">Every page looks exactly like the PDF, but it is a picture: the text cannot be edited.</span>
        </span>
      </label>
      {o.mode === 'picture' && (
        <label className="flex items-center gap-2 text-sm">
          Resolution
          <select value={o.dpi} onChange={(e) => set({ dpi: Number(e.target.value) })} className={inputClass}>
            <option value={100}>100 dpi (small file)</option>
            <option value={150}>150 dpi (reading)</option>
            <option value={200}>200 dpi (sharp)</option>
          </select>
        </label>
      )}
      <label className="block space-y-1 text-sm">
        Pages
        <input type="text" value={o.pages} onChange={(e) => set({ pages: e.target.value })} placeholder="All pages, or like 1-3, 5" className={`${inputClass} w-full`} />
      </label>
      {o.mode === 'editable' && (
        <p className="text-xs text-muted">Each PDF page becomes a page of the document. Fonts keep their names, and Word uses a similar one when it is not installed, so lines can break differently. Drawings and shapes are left out, and scans stay pictures: reading text out of them needs OCR, which Ream does not have yet.</p>
      )}
    </fieldset>
  )
}
