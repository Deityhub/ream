import type { PanelProps } from '../panels.ts'
import type { SplitOptions } from './run.ts'

export const defaultOptions: SplitOptions = { mode: 'ranges', ranges: '', every: 1 }

const input =
  'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent'

export function Panel({ options, onChange }: PanelProps<SplitOptions>) {
  const set = (patch: Partial<SplitOptions>) => onChange({ ...options, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Split by</legend>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <input type="radio" name="split-mode" checked={options.mode === 'ranges'} onChange={() => set({ mode: 'ranges' })} />
        Page ranges
        <input
          type="text"
          value={options.ranges}
          onChange={(e) => set({ mode: 'ranges', ranges: e.target.value })}
          placeholder="1-3, 4-6, 7-"
          aria-label="Page ranges, one file per comma"
          className={`${input} w-48`}
        />
        <span className="text-xs text-muted">One file per comma</span>
      </label>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <input type="radio" name="split-mode" checked={options.mode === 'every'} onChange={() => set({ mode: 'every' })} />
        Every
        <input
          type="number"
          min={1}
          value={options.every}
          onChange={(e) => set({ mode: 'every', every: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
          aria-label="Pages per file"
          className={`${input} w-20`}
        />
        pages
      </label>
    </fieldset>
  )
}
