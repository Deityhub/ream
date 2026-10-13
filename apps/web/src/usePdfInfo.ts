import { useEffect, useState } from 'react'
import { inspectPdf, type PdfInfo } from './previewClient'

export const isPdf = (f: { name: string; type: string }) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

export function usePdfInfo(file: Blob | undefined): PdfInfo | 'loading' {
  const [info, setInfo] = useState<PdfInfo | 'loading'>('loading')
  useEffect(() => {
    if (!file) return
    let live = true
    setInfo('loading')
    inspectPdf(file).then(
      (i) => live && setInfo(i),
      () => live && setInfo({ kind: 'error', message: "Couldn't read this PDF." }),
    )
    return () => {
      live = false
    }
  }, [file])
  return info
}

/** "12 pages" / "1 page" */
export const pageCount = (info: PdfInfo | 'loading') => (info === 'loading' || info.kind !== 'ok' ? null : `${info.pages.length} ${info.pages.length === 1 ? 'page' : 'pages'}`)
