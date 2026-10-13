import { useEffect, useState } from 'react'
import { Icon } from '@ream/ui'
import { formatBytes } from '@ream/core'
import { isPdf, pageCount, usePdfInfo } from './usePdfInfo'
import { wasUnlocked } from './previewClient'
import { PdfPage } from './PdfPage'

export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return setUrl(undefined)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/** small square preview of a file: the picture for images, a document icon for PDFs */
export function Thumb({ file }: { file: File }) {
  const image = file.type.startsWith('image/')
  const url = useObjectUrl(image ? file : undefined)
  const box = 'flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line'
  if (image) return <div className={`${box} checker`}>{url && <img src={url} alt="" className="size-full object-cover" />}</div>
  return <PdfThumb file={file} box={box} />
}

function PdfThumb({ file, box }: { file: File; box: string }) {
  const info = usePdfInfo(file)
  const first = info !== 'loading' && info.kind === 'ok' ? info.pages[0] : undefined
  if (!first) {
    return (
      <div className={`${box} bg-surface-2`}>
        <Icon name="file" className="size-5 text-muted" />
      </div>
    )
  }
  const tall = first.height >= first.width
  return (
    <div className={`${box} bg-surface-2`}>
      <div className="bg-white shadow-sm ring-1 ring-line" style={{ aspectRatio: `${first.width} / ${first.height}`, height: tall ? '100%' : undefined, width: tall ? undefined : '100%' }}>
        <PdfPage file={file} page={0} renderWidth={96} />
      </div>
    </div>
  )
}

/** second line under a file name: size, plus page count for PDFs */
export function FileMeta({ file }: { file: File }) {
  return isPdf(file) ? <PdfMeta file={file} /> : <span className="text-xs tabular-nums text-muted">{formatBytes(file.size)}</span>
}

function PdfMeta({ file }: { file: File }) {
  const info = usePdfInfo(file)
  const pages = pageCount(info)
  return (
    <span className="text-xs tabular-nums text-muted">
      {[pages, formatBytes(file.size), wasUnlocked(file) ? 'unlocked' : null].filter(Boolean).join(' · ')}
      {info !== 'loading' && info.kind === 'error' && ` · ${info.message}`}
    </span>
  )
}
