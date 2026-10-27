import { useEffect, useState } from 'react'
import { inspectPdf, type PdfInfo } from './previewClient'

export const isPdf = (f: { name: string; type: string }) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

/** a Word, Excel or PowerPoint file the preview worker converts to a PDF to show it */
export const officeKind = (name: string) => (/\.(pptx|xlsx|docx)$/i.exec(name)?.[1].toLowerCase() as 'pptx' | 'xlsx' | 'docx' | undefined) ?? null

/** files shown page by page: PDFs and Office files */
export const isPreviewable = (f: { name: string; type: string }) => isPdf(f) || officeKind(f.name) !== null

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
      () => live && setInfo({ kind: 'error', message: "Couldn't read this file." }),
    )
    return () => {
      live = false
    }
  }, [file, keepPrevious])
  return info
}

/** "12 pages" / "1 page", or slides for a deck */
export function pageCount(info: PdfInfo | 'loading', name = ''): string | null {
  if (info === 'loading' || info.kind !== 'ok') return null
  const unit = officeKind(name) === 'pptx' ? 'slide' : 'page'
  return `${info.pages.length} ${unit}${info.pages.length === 1 ? '' : 's'}`
}
