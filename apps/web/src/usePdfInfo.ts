import { useEffect, useState } from 'react'
import { inspectPdf, type PdfInfo } from './previewClient'

export const isPdf = (f: { name: string; type: string }) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

/**
 * `keepPrevious`: while a new file is being read, keep returning the last readable result instead of 'loading', so a
 * preview that is refreshed with a new version of the same document doesn't blink.
 */
export function usePdfInfo(file: Blob | undefined, keepPrevious = false): PdfInfo | 'loading' {
  const [info, setInfo] = useState<PdfInfo | 'loading'>('loading')
  useEffect(() => {
    if (!file) return
    let live = true
    setInfo((prev) => (keepPrevious && prev !== 'loading' && prev.kind === 'ok' ? prev : 'loading'))
    inspectPdf(file).then(
      (i) => live && setInfo(i),
      () => live && setInfo({ kind: 'error', message: "Couldn't read this PDF." }),
    )
    return () => {
      live = false
    }
  }, [file, keepPrevious])
  return info
}

/** "12 pages" / "1 page" */
export const pageCount = (info: PdfInfo | 'loading') => (info === 'loading' || info.kind !== 'ok' ? null : `${info.pages.length} ${info.pages.length === 1 ? 'page' : 'pages'}`)
