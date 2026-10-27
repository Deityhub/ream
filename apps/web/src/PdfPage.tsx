import { useEffect, useRef, useState } from 'react'
import { Icon } from '@ream/ui'
import { renderPdfPage, type PageHide } from './previewClient'

type Props = {
  file: Blob
  /** 0-based */
  page: number
  /** pixels the page is rendered across (the canvas is then scaled by CSS) */
  renderWidth: number
  /** false leaves the page's form fields out (an editor shows its own) */
  fields?: boolean
  /** what an editor changed, left out of the picture (fractions of the page) */
  hide?: PageHide
  className?: string
  onWarnings?: (warnings: string[]) => void
}

/** One page of a PDF, drawn by our own renderer in the preview worker. */
export function PdfPage({ file, page, renderWidth, fields = true, hide, className = '', onWarnings }: Props) {
  const hideKey = hide ? JSON.stringify(hide) : ''
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const report = useRef(onWarnings)
  report.current = onWarnings

  useEffect(() => {
    let live = true
    setState((s) => (s === 'ok' ? s : 'loading')) // a page that is already drawn stays on screen until its replacement is ready
    renderPdfPage(file, page, renderWidth, fields, hide).then(
      ({ bitmap, warnings }) => {
        const c = canvas.current
        if (!live || !c) return
        c.width = bitmap.width
        c.height = bitmap.height
        c.getContext('2d')!.drawImage(bitmap, 0, 0)
        setState('ok')
        report.current?.(warnings)
      },
      () => live && setState('error'),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, page, renderWidth, fields, hideKey])

  return (
    <div className="relative size-full">
      <canvas ref={canvas} aria-label={`Page ${page + 1}`} role="img" className={`size-full ${state === 'ok' ? '' : 'invisible'} ${className}`} />
      {state !== 'ok' && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-2 text-muted">
          {state === 'error' ? <Icon name="file" className="size-5" /> : <span className="size-4 animate-pulse rounded-full bg-line" />}
        </div>
      )}
    </div>
  )
}

/** A page that reserves its space up front and only renders once it scrolls near the viewport. */
export function LazyPdfPage({ file, page, size, renderWidth, width, onWarnings }: { file: Blob; page: number; size: { width: number; height: number }; renderWidth: number; /** CSS pixels across; the full width of its container when not given */ width?: number; onWarnings?: (w: string[]) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={box} style={{ aspectRatio: `${size.width} / ${size.height}`, width: width ?? '100%' }} className="mx-auto shrink-0 overflow-hidden bg-white shadow-sm ring-1 ring-line">
      {near && <PdfPage file={file} page={page} renderWidth={renderWidth} onWarnings={onWarnings} />}
    </div>
  )
}
