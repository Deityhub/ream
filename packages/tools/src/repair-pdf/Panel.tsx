import { useEffect, useState } from 'react'
import type { PanelProps } from '../panels.ts'

export const defaultOptions = {}

type Status = { kind: 'checking' } | { kind: 'fine'; pages: number } | { kind: 'rebuilt'; pages: number } | { kind: 'broken'; message?: string }

export function Panel({ files, pdfHost }: PanelProps) {
  const file = files[0]
  const [status, setStatus] = useState<Status>({ kind: 'checking' })
  useEffect(() => {
    setStatus({ kind: 'checking' })
    if (!file || !pdfHost) return
    let live = true
    pdfHost.check(file).then(
      (r) => live && setStatus(r.ok ? { kind: r.rebuilt ? 'rebuilt' : 'fine', pages: r.pages } : { kind: 'broken', message: r.message }),
      () => live && setStatus({ kind: 'broken' }),
    )
    return () => {
      live = false
    }
  }, [file, pdfHost])

  const pages = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`
  return (
    <div className="space-y-2 text-sm">
      <h2 className="font-medium">Repair</h2>
      <p role="status" className="text-muted">
        {status.kind === 'checking' && 'Checking the file…'}
        {status.kind === 'fine' && `This file opens normally (${pages(status.pages)}). Repairing saves a clean copy of it.`}
        {status.kind === 'rebuilt' && `This file's index was damaged. ${pages(status.pages)} could be read, and a repaired copy has a new, correct index.`}
        {status.kind === 'broken' && `${status.message ?? "This file can't be read normally."} Repairing tries to recover whatever pages are still in it.`}
      </p>
      <p className="text-xs text-muted">Repair rebuilds the file's index, page list and stream lengths and leaves out parts that can't be read. Pages whose content is cut off may come out blank. Bookmarks, forms and links that are still intact are kept.</p>
    </div>
  )
}
