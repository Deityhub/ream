import { useState } from 'react'
import { inputClass } from '../fields.tsx'
import type { PanelProps } from '../panels.ts'
import { defaultOptions, type ProtectPdfOptions as O } from './options.ts'

export { defaultOptions }

export function Panel({ options: o, onChange }: PanelProps<O>) {
  const [show, setShow] = useState(false)
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  const type = show ? 'text' : 'password'
  const restricted = !o.allowPrint || !o.allowCopy || !o.allowModify
  const mismatch = o.confirm !== '' && o.confirm !== o.password
  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium">Password to open the file</legend>
        <label className="block space-y-1 text-sm">
          Password
          <input type={type} value={o.password} autoComplete="new-password" onChange={(e) => set({ password: e.target.value })} className={`${inputClass} w-full`} />
        </label>
        <label className="block space-y-1 text-sm">
          Type it again
          <input type={type} value={o.confirm} autoComplete="new-password" aria-invalid={mismatch} onChange={(e) => set({ confirm: e.target.value })} className={`${inputClass} w-full`} />
        </label>
        {mismatch && (
          <p role="status" className="text-xs text-danger">
            The two passwords don't match.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show the passwords
        </label>
        <p className="text-xs text-muted">Nobody can recover a forgotten password, not even Ream: nothing is stored. Keep it somewhere safe.</p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">What people who open it may do</legend>
        {(
          [
            ['allowPrint', 'Print it'],
            ['allowCopy', 'Copy text and pictures out of it'],
            ['allowModify', 'Edit it, fill in forms and add comments'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={o[key]} onChange={(e) => set({ [key]: e.target.checked })} />
            {label}
          </label>
        ))}
        {restricted && (
          <label className="block space-y-1 pt-1 text-sm">
            Owner password (to lift these limits later)
            <input type={type} value={o.ownerPassword} autoComplete="new-password" onChange={(e) => set({ ownerPassword: e.target.value })} className={`${inputClass} w-full`} />
            <span className="block text-xs text-muted">Optional. Left empty, one is made up and nobody knows it.</span>
          </label>
        )}
        <p className="text-xs text-muted">These limits are a request: most PDF apps respect them, but they are not a lock. Only the password above keeps people out.</p>
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={o.compatible} onChange={(e) => set({ compatible: e.target.checked })} className="mt-0.5" />
        <span>
          Compatibility mode
          <span className="block text-xs text-muted">Uses AES-128 instead of AES-256 so very old PDF readers can open the file. AES-256 is stronger and is the default.</span>
        </span>
      </label>
    </div>
  )
}
