import { useEffect, useState } from 'react'
import type { PanelProps } from '../panels.ts'
import { inputClass } from '../fields.tsx'
import type { MetadataOptions as O } from './run.ts'

export const defaultOptions: O = { fields: {} }

const FIELDS = [
  { key: 'Title', label: 'Title' },
  { key: 'Author', label: 'Author' },
  { key: 'Subject', label: 'Subject' },
  { key: 'Keywords', label: 'Keywords' },
  { key: 'Creator', label: 'Created with' },
  { key: 'Producer', label: 'Converted by' },
] as const

export function Panel({ options, onChange, files, readMetadata }: PanelProps<O>) {
  const [current, setCurrent] = useState<Record<string, string>>({})
  const file = files[0]
  // show what the file has now; changed fields live in the options, so untouched ones stay as they are
  useEffect(() => {
    setCurrent({})
    onChange(defaultOptions)
    if (!file || !readMetadata) return
    let live = true
    readMetadata(file).then((m) => live && setCurrent(m), () => {})
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, readMetadata])

  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Document information</legend>
      {FIELDS.map((f) => (
        <label key={f.key} className="block space-y-1 text-sm">
          {f.label}
          <input
            type="text"
            value={options.fields[f.key] ?? current[f.key] ?? ''}
            onChange={(e) => onChange({ fields: { ...options.fields, [f.key]: e.target.value } })}
            className={`${inputClass} w-full`}
          />
        </label>
      ))}
      <p className="text-xs text-muted">Clear a field to remove it. The dates stay as they are, apart from the modified date.</p>
    </fieldset>
  )
}
