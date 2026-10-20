import { useEffect, useState } from 'react'
import { Icon } from '@ream/ui'
import { CropSurface } from '../CropSurface.tsx'
import { WHOLE, type Rect } from '../rect.ts'
import type { PanelProps } from '../panels.ts'
import { usePageZoom } from '../PageZoom.tsx'
import { areasFor, defaultOptions, pagesToRedact, type RedactPdfOptions as O } from './areas.ts'

export { defaultOptions }
export const placesActions = true

type Size = { width: number; height: number }
const radio = 'flex items-start gap-2 text-sm'
const button = 'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 pointer-coarse:min-h-11'

export function Panel({ options: o, onChange, files, pdfHost, actions }: PanelProps<O>) {
  const file = files[0]
  const [pages, setPages] = useState<Size[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [current, setCurrent] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    setPages(null)
    setFailed(false)
    setCurrent(0)
    setSelected(null)
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

  // the page's zoom (the whole page in view to start with)
  const zoom = usePageZoom(pages ? pages[Math.min(current, pages.length - 1)] : undefined, file)

  if (!file || !pdfHost) return <Waiting actions={actions}>Add a PDF, then drag on a page to mark what to redact.</Waiting>
  if (failed) return <Waiting actions={actions}>This PDF can't be shown here, so there's nothing to mark on.</Waiting>
  if (!pages) return <Waiting actions={actions}>Reading the pages…</Waiting>

  const { PdfPage } = pdfHost
  const size = pages[Math.min(current, pages.length - 1)]
  const areas = areasFor(o, current)
  const setAreas = (next: Rect[]) => onChange(o.scope === 'all' ? { ...o, areas: next } : { ...o, areasByPage: { ...o.areasByPage, [current]: next } })
  const active = selected !== null && areas[selected] ? selected : null
  // drawing on the page adds an area; with one selected, it moves or resizes that one
  const choose = (r: Rect) => {
    if (active === null) {
      setSelected(areas.length)
      setAreas([...areas, r])
    } else setAreas(areas.map((a, i) => (i === active ? r : a)))
  }
  const remove = (i: number) => {
    setAreas(areas.filter((_, j) => j !== i))
    setSelected(null)
  }
  const setScope = (scope: O['scope']) => {
    if (scope === o.scope) return
    // the areas on the page you are looking at come along
    onChange(scope === 'all' ? { ...o, scope, areas } : { ...o, scope, areasByPage: { ...o.areasByPage, [current]: areas } })
  }
  const go = (by: number) => {
    setCurrent((c) => Math.min(pages.length - 1, Math.max(0, c + by)))
    setSelected(null)
  }
  const marked = pagesToRedact(o, pages.length).length
  const wholePage = areas.some((a) => a.x <= 0.001 && a.y <= 0.001 && a.w >= 0.998 && a.h >= 0.998)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="min-w-0 space-y-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => go(-1)} disabled={current === 0} aria-label="Previous page" className={button}>
            Previous
          </button>
          <span role="status" className="text-sm tabular-nums">
            Page {current + 1} of {pages.length}
          </span>
          <button type="button" onClick={() => go(1)} disabled={current >= pages.length - 1} aria-label="Next page" className={button}>
            Next
          </button>
          <span className="ml-auto">{zoom.bar}</span>
        </div>
        <div ref={zoom.scroller} className="max-h-[75vh] overflow-auto">
          <CropSurface rect={active === null ? null : areas[active]} onChange={choose} dim={false} inside={<span className="block size-full" style={{ background: 'rgb(0 0 0 / 0.6)' }} />} className="mx-auto" style={{ aspectRatio: `${size.width} / ${size.height}`, width: zoom.width || '100%' }}>
            <PdfPage key={current} file={file} page={current} renderWidth={zoom.renderWidth} />
            {areas.map((r, i) =>
              i === active ? null : (
                // the black the saved file will have, in both themes (not a theme colour)
                <span key={i} className="pointer-events-none absolute outline-2 outline-dashed outline-accent" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: 'rgb(0 0 0 / 0.8)' }} />
              ),
            )}
          </CropSurface>
        </div>
        <p className="text-xs text-muted">Drag on the page to mark an area. With an area selected, drag inside it to move it or a corner to resize it.</p>
      </div>

      <div className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-4">
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Areas on this page</span>
            <button type="button" onClick={() => setSelected(null)} disabled={active === null} className={button}>
              New area
            </button>
          </div>
          {areas.length === 0 ? (
            <p className="text-xs text-muted">None yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {areas.map((_, i) => (
                <li key={i} className="flex items-center gap-2 px-2.5 py-1">
                  <button type="button" onClick={() => setSelected(i)} aria-pressed={i === active} className="min-w-0 flex-1 rounded px-1 py-1 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent aria-pressed:font-medium pointer-coarse:min-h-11">
                    Area {i + 1}
                  </button>
                  <button type="button" onClick={() => remove(i)} aria-label={`Remove area ${i + 1}`} className="rounded p-1 text-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:p-3">
                    <Icon name="x" className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setAreas([WHOLE])} disabled={wholePage} className={button}>
            Redact the whole page
          </button>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Apply to</legend>
          <label className={radio}>
            <input type="radio" name="redact-scope" checked={o.scope === 'page'} onChange={() => setScope('page')} className="mt-0.5" />
            <span>
              Each page its own areas<span className="block text-xs text-muted">Pages you don't mark are left alone.</span>
            </span>
          </label>
          <label className={radio}>
            <input type="radio" name="redact-scope" checked={o.scope === 'all'} onChange={() => setScope('all')} className="mt-0.5" />
            <span>
              All pages<span className="block text-xs text-muted">The same areas on every page, such as a header or a footer.</span>
            </span>
          </label>
        </fieldset>

        <label className={radio}>
          <input type="checkbox" checked={o.hidden} onChange={(e) => onChange({ ...o, hidden: e.target.checked })} className="mt-0.5" />
          <span>
            Remove document properties and hidden data<span className="block text-xs text-muted">The title, author and other details, XMP metadata, page thumbnails and data other apps keep in the file.</span>
          </span>
        </label>

        <p className="text-xs text-muted">
          Redaction can't be undone. What lies under an area is removed from the file, not just covered: letters, the parts of shapes and pictures inside it, and comments, links and form fields over it. A black box marks each area.
        </p>
        <p className="text-sm text-muted" role="status">
          {marked === 0 ? 'Drag on a page to mark what to redact.' : o.scope === 'all' ? `All ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} will be redacted the same way.` : `${marked} of ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} will be redacted.`}
        </p>
        {actions}
      </div>
    </div>
  )
}

/** a message in place of the panel, with the run button still there */
function Waiting({ children, actions }: { children: string; actions: PanelProps['actions'] }) {
  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{children}</p>
      {actions}
    </div>
  )
}
