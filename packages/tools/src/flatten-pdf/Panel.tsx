import type { PanelProps } from '../panels.ts'
import type { FlattenPdfOptions as O } from './run.ts'

export const defaultOptions: O = { forms: true, comments: true }

export function Panel({ options: o, onChange }: PanelProps<O>) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Flatten</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={o.forms} onChange={(e) => onChange({ ...o, forms: e.target.checked })} className="mt-1" />
        <span>
          Form fields
          <span className="block text-xs text-muted">What is typed in stays on the page; the boxes can no longer be edited.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={o.comments} onChange={(e) => onChange({ ...o, comments: e.target.checked })} className="mt-1" />
        <span>
          Comments and markup
          <span className="block text-xs text-muted">Notes, highlights, stamps and drawings become part of the page.</span>
        </span>
      </label>
      <p className="text-xs text-muted">Links stay clickable. Digital signatures stop being valid. Everything else in the file is kept.</p>
    </fieldset>
  )
}
