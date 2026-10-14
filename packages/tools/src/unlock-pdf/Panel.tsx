import type { PanelProps } from '../panels.ts'

export const defaultOptions = {}

export function Panel({ files }: PanelProps<Record<string, never>>) {
  return (
    <div className="space-y-2 text-sm">
      <p>{files.length ? 'Press the button to save a copy with no password and no limits.' : 'Add a protected PDF. If it needs a password to open, you will be asked for it.'}</p>
      <p className="text-xs text-muted">The password is used once on this device and is not kept. Only unlock files you have the right to open. Files with an owner password that only restrict printing or copying are unlocked without asking.</p>
    </div>
  )
}
