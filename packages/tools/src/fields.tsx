import type { OutputMime } from '@ream/image-core'
import { FORMATS } from './image-formats.ts'

export const inputClass =
  'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent'

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
