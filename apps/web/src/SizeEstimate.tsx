import { formatBytes } from '@ream/core'
import { Button } from '@ream/ui'
import type { PreviewState } from './previewController'

/** what a run would make of the files, as a size beside the options (tools whose preview is just the size, like Compress PDF) */
export function SizeEstimate({ files, preview, onRefresh }: { files: File[]; preview: PreviewState; onRefresh: () => void }) {
  const before = files.reduce((n, f) => n + f.size, 0)
  if (preview.kind === 'idle') return null
  if (preview.kind === 'manual') {
    return (
      <div className="space-y-2 text-sm text-muted">
        <p>This file is large, so the new size is worked out only when you ask.</p>
        <Button variant="secondary" onClick={onRefresh}>Work out the new size</Button>
      </div>
    )
  }
  if (preview.kind === 'error') return <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-ink">Can't work out the new size: {preview.message}</p>
  if (preview.kind === 'pending') return <p role="status" className="text-sm text-muted">Working out the new size…</p>
  const after = preview.outputs.reduce((n, o) => n + o.bytes.length, 0)
  const saved = before - after
  const dim = preview.stale || preview.computing
  return (
    <div role="status" aria-busy={preview.computing} className={`rounded-lg bg-surface-2 px-3 py-2 text-sm transition-opacity ${dim ? 'opacity-60' : ''}`}>
      <p className="flex flex-wrap items-baseline gap-x-2 font-mono">
        <span className="text-muted">New size</span>
        <span className="font-medium">{formatBytes(after)}</span>
        <span className="text-muted">was {formatBytes(before)}</span>
      </p>
      <p className="text-xs text-muted">
        {preview.computing ? 'Updating…' : saved > 0 ? `${Math.round((saved / before) * 100)}% smaller, ${formatBytes(saved)} less` : "It can't be made smaller with these settings, so the file stays as it is."}
      </p>
    </div>
  )
}
