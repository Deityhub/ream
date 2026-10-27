import type { PanelProps } from '../panels.ts'
import { RangeField, inputClass } from '../fields.tsx'
import type { ImagesToPdfOptions as O } from './run.ts'
import { CUSTOM_MM, PAGE_SIZES, maxMarginMm, type PageSizeKey } from './sizes.ts'

export const defaultOptions: O = { size: 'fit', customWidth: 210, customHeight: 297, orientation: 'auto', margin: 0 }

const GROUPS = ['ISO', 'North American'] as const

export function Panel({ options, onChange }: PanelProps<O>) {
  // changing the page size can make the current margin too big for it
  const set = (patch: Partial<O>) => {
    const next = { ...options, ...patch }
    onChange({ ...next, margin: Math.min(next.margin, maxMarginMm(next)) })
  }
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Pages</legend>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Page size
        <select value={options.size} onChange={(e) => set({ size: e.target.value as O['size'] })} className={inputClass}>
          <option value="fit">Same as the image</option>
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {(Object.keys(PAGE_SIZES) as PageSizeKey[])
                .filter((k) => PAGE_SIZES[k].group === g)
                .map((k) => (
                  <option key={k} value={k}>
                    {PAGE_SIZES[k].label}
                  </option>
                ))}
            </optgroup>
          ))}
          <option value="custom">Custom size</option>
        </select>
      </label>
      {options.size === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input type="number" aria-label="Page width in millimetres" min={CUSTOM_MM.min} max={CUSTOM_MM.max} value={options.customWidth} onChange={(e) => set({ customWidth: Number(e.target.value) })} className={`${inputClass} w-24`} />
          ×
          <input type="number" aria-label="Page height in millimetres" min={CUSTOM_MM.min} max={CUSTOM_MM.max} value={options.customHeight} onChange={(e) => set({ customHeight: Number(e.target.value) })} className={`${inputClass} w-24`} />
          mm
        </div>
      )}
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
      <RangeField label="Margin" value={options.margin} min={0} max={maxMarginMm(options)} unit=" mm" onChange={(margin) => set({ margin })} />
      <p className="text-xs text-muted">One page per image, in the order shown above. JPG files are added as they are, without losing quality.</p>
    </fieldset>
  )
}
