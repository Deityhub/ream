import type { PanelProps } from '../panels.ts'
import { inputClass } from '../fields.tsx'
import type { ImagesToPdfOptions as O } from './run.ts'

export const defaultOptions: O = { size: 'fit', orientation: 'auto', margin: 'none' }

export function Panel({ options, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...options, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Pages</legend>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Page size
        <select value={options.size} onChange={(e) => set({ size: e.target.value as O['size'] })} className={inputClass}>
          <option value="fit">Same as the image</option>
          <option value="a4">A4</option>
          <option value="letter">US Letter</option>
        </select>
      </label>
      {options.size !== 'fit' && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Orientation
          <select value={options.orientation} onChange={(e) => set({ orientation: e.target.value as O['orientation'] })} className={inputClass}>
            <option value="auto">Match each image</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
      )}
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Margin
        <select value={options.margin} onChange={(e) => set({ margin: e.target.value as O['margin'] })} className={inputClass}>
          <option value="none">None</option>
          <option value="small">Small</option>
          <option value="big">Big</option>
        </select>
      </label>
      <p className="text-xs text-muted">One page per image, in the order shown above. JPG files are added as they are, without losing quality.</p>
    </fieldset>
  )
}
