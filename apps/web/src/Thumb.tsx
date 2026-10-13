import { useEffect, useState } from 'react'
import { Icon } from '@ream/ui'
import { formatBytes } from '@ream/core'
import { isPdf, pageCount, usePdfInfo } from './usePdfInfo'
import { wasUnlocked } from './previewClient'

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
  return (
    <div className={`${box} bg-surface-2`}>
      <Icon name="file" className="size-5 text-muted" />
    </div>
  )
}

/** second line under a file name: size, plus page count for PDFs */
export function FileMeta({ file }: { file: File }) {
  return isPdf(file) ? <PdfMeta file={file} /> : <span className="text-xs text-muted">{formatBytes(file.size)}</span>
}

function PdfMeta({ file }: { file: File }) {
  const info = usePdfInfo(file)
  const pages = pageCount(info)
  return (
    <span className="text-xs text-muted">
      {[pages, formatBytes(file.size), wasUnlocked(file) ? 'unlocked' : null].filter(Boolean).join(' · ')}
      {info !== 'loading' && info.kind === 'error' && ` · ${info.message}`}
    </span>
  )
}
