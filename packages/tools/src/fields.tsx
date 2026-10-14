import type { OutputMime } from '@ream/image-core'
import { FORMATS } from './image-formats.ts'
import type { Spot } from './pdf-common.ts'

export const inputClass =
  'rounded-lg border border-field bg-surface px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent'

/** whole number from a text box; empty or invalid becomes 0 */
export const toInt = (v: string) => Math.max(0, Math.floor(Number(v)) || 0)

export function FormatFields({
  format,
  quality,
  onChange,
}: {
  format: OutputMime
  quality: number
  onChange: (patch: { format?: OutputMime; quality?: number }) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <label className="flex items-center gap-2">
        Save as
        <select value={format} onChange={(e) => onChange({ format: e.target.value as OutputMime })} className={inputClass}>
          {FORMATS.map((f) => (
            <option key={f.mime} value={f.mime}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {format !== 'image/png' && (
        <label className="flex items-center gap-2">
          Quality
          <input type="range" min={40} max={100} value={quality} onChange={(e) => onChange({ quality: Number(e.target.value) })} />
          <span className="w-8 text-muted">{quality}</span>
        </label>
      )}
    </div>
  )
}

const SPOTS: [Spot, string][] = [
  ['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'],
  ['ml', 'Middle left'], ['mc', 'Centre'], ['mr', 'Middle right'],
  ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right'],
]

/** a 3x3 grid for picking where something goes on the page; `allowed` greys out the spots a tool doesn't use */
export function SpotPicker({ label, value, onChange, allowed }: { label: string; value: Spot; onChange: (v: Spot) => void; allowed?: Spot[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid w-fit grid-cols-3 gap-1 rounded-lg border border-line bg-surface-2 p-1">
      {SPOTS.map(([spot, name]) => {
        const off = allowed && !allowed.includes(spot)
        return (
          <button
            key={spot}
            type="button"
            role="radio"
            aria-checked={value === spot}
            aria-label={name}
            title={name}
            disabled={off}
            onClick={() => onChange(spot)}
            className={`size-7 rounded-md transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-25 pointer-coarse:size-10 ${value === spot ? 'bg-accent' : 'bg-surface hover:bg-accent-soft'}`}
          />
        )
      })}
    </div>
  )
}
