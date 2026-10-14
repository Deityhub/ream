import { useEffect, useState } from 'react'
import { inputClass } from '../fields.tsx'
import { CropSurface } from '../CropSurface.tsx'
import { WHOLE, isWhole, withSide, type Rect } from '../rect.ts'
import type { PanelProps } from '../panels.ts'
import { MM } from '../images-to-pdf/sizes.ts'
import { defaultOptions, pagesToCrop, type CropPdfOptions as O } from './margins.ts'

export { defaultOptions }

type Size = { width: number; height: number }
const radio = 'flex items-start gap-2 text-sm'

export function Panel({ options: o, onChange, files, pdfHost }: PanelProps<O>) {
  const file = files[0]
  const [pages, setPages] = useState<Size[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    setPages(null)
    setFailed(false)
    setCurrent(0)
    onChange(defaultOptions)
    if (!file || !pdfHost) return
    let live = true
    pdfHost.pages(file).then(
      (p) => live && setPages(p),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  if (!file || !pdfHost) return <p className="text-sm text-muted">Add a PDF, then drag on a page to choose the area to keep.</p>
  if (failed) return <p className="text-sm text-muted">This PDF can't be shown here, so it can't be cropped by dragging.</p>
  if (!pages) return <p className="text-sm text-muted">Reading the pages…</p>

  const { PdfPage } = pdfHost
  const size = pages[Math.min(current, pages.length - 1)]
  const rect: Rect = (o.scope === 'all' ? o.rect : o.rects[current]) ?? WHOLE
  const setRect = (r: Rect) => onChange(o.scope === 'all' ? { ...o, rect: r } : { ...o, rects: { ...o.rects, [current]: r } })
  const count = pagesToCrop(o, pages.length).length

  // changing the scope carries the selection you are looking at across
  const setScope = (scope: O['scope']) => {
    if (scope === o.scope) return
    onChange(scope === 'all' ? { ...o, scope, rect: o.rects[current] ?? o.rect } : { ...o, scope, rects: { ...o.rects, [current]: o.rects[current] ?? o.rect } })
  }

  // numeric fields in millimetres: the keyboard route to the same selection
  const mm = (key: keyof Rect) => Math.round(((key === 'x' || key === 'w' ? size.width : size.height) * rect[key]) / MM * 10) / 10
  const setMm = (key: keyof Rect, v: number) => setRect(withSide(rect, key, (v * MM) / (key === 'x' || key === 'w' ? size.width : size.height)))
  const field = (key: keyof Rect, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-12 shrink-0">{label}</span>
      <input type="number" min={0} step="any" value={mm(key)} onChange={(e) => setMm(key, Number(e.target.value) || 0)} aria-label={`${label} in millimetres`} className={`${inputClass} w-full`} />
    </label>
  )
  const go = (by: number) => setCurrent((c) => Math.min(pages.length - 1, Math.max(0, c + by)))

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => go(-1)} disabled={current === 0} aria-label="Previous page" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40">
            Previous
          </button>
          <span role="status" className="text-sm tabular-nums">
            Page {current + 1} of {pages.length}
          </span>
          <button type="button" onClick={() => go(1)} disabled={current >= pages.length - 1} aria-label="Next page" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40">
            Next
          </button>
        </div>
        <CropSurface rect={rect} onChange={setRect} className="mx-auto" style={{ aspectRatio: `${size.width} / ${size.height}`, width: `min(100%, calc(62vh * ${size.width / size.height}))` }}>
          <PdfPage key={current} file={file} page={current} renderWidth={900} />
        </CropSurface>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {field('x', 'Left')}
          {field('y', 'Top')}
          {field('w', 'Width')}
          {field('h', 'Height')}
        </div>
        <button type="button" onClick={() => setRect(WHOLE)} disabled={isWhole(rect)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40">
          Reset selection
        </button>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Apply to</legend>
          <label className={radio}>
            <input type="radio" name="crop-scope" checked={o.scope === 'all'} onChange={() => setScope('all')} className="mt-0.5" />
            <span>All pages<span className="block text-xs text-muted">The same margins on every page.</span></span>
          </label>
          <label className={radio}>
            <input type="radio" name="crop-scope" checked={o.scope === 'page'} onChange={() => setScope('page')} className="mt-0.5" />
            <span>This page only<span className="block text-xs text-muted">Each page keeps its own selection; pages without one are left alone.</span></span>
          </label>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Cropped-out parts</legend>
          <label className={radio}>
            <input type="radio" name="crop-remove" checked={o.remove} onChange={() => onChange({ ...o, remove: true })} className="mt-0.5" />
            <span>Delete them<span className="block text-xs text-muted">Whatever lies fully outside the selection is removed from the file.</span></span>
          </label>
          <label className={radio}>
            <input type="radio" name="crop-remove" checked={!o.remove} onChange={() => onChange({ ...o, remove: false })} className="mt-0.5" />
            <span>Just hide them<span className="block text-xs text-muted">The page gets smaller but nothing is removed, so the edges stay in the file.</span></span>
          </label>
        </fieldset>

        <p className="text-sm text-muted" role="status">
          {count === 0
            ? 'Drag on the page to choose the area to keep.'
            : o.scope === 'all'
              ? `All ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} will be cropped the same way.`
              : `${count} of ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} will be cropped.`}
        </p>
      </div>
    </div>
  )
}
