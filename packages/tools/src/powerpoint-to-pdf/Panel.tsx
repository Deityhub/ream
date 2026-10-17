import { Icon } from '@ream/ui'
import type { PanelProps } from '../panels.ts'
import type { PowerpointToPdfOptions as O } from './run.ts'

export const defaultOptions: O = { hidden: false, fontFile: null, fontName: '' }

export function Panel({ options: o, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Slides</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={o.hidden} onChange={(e) => set({ hidden: e.target.checked })} />
        Include hidden slides
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
        Each slide becomes a page of its own size. Text is set again in Helvetica, Times or Courier chosen by font name, so lines can break differently, and letters those fonts do not have show as ?; a font file (.ttf) is used for all text instead. Charts and diagrams are marked where they were, and animations, notes, vertical text, gradients (their first colour) and unusual shapes (drawn as a box) are not reproduced.
      </p>
    </fieldset>
  )
}
