import { useEffect, useState } from 'react'
import { CropSurface } from '../CropSurface.tsx'
import type { PanelProps } from '../panels.ts'
import { SignaturePad } from './SignaturePad.tsx'
import { defaultOptions, defaultRect, pagesToSign, type SignPdfOptions as O } from './place.ts'

export { defaultOptions }
export const placesActions = true

type Size = { width: number; height: number }
const radio = 'flex items-start gap-2 text-sm'

export function Panel({ options: o, onChange, files, pdfHost, actions }: PanelProps<O>) {
  const file = files[0]
  const [pages, setPages] = useState<Size[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [current, setCurrent] = useState(0)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    setPages(null)
    setFailed(false)
    setCurrent(0)
    onChange({ ...defaultOptions, image: o.image })
    if (!file || !pdfHost) return
    let live = true
    pdfHost.pages(file).then(
      (p) => {
        if (!live) return
        setPages(p)
        setCurrent(p.length - 1) // signatures go at the end by default
      },
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // the signature as a picture shown inside the box on the page
  useEffect(() => {
    if (!o.image) return setPreview(null)
    const url = URL.createObjectURL(new Blob([o.image as BlobPart], { type: 'image/png' }))
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [o.image])

  if (!file || !pdfHost) return <Waiting actions={actions}>Add a PDF, then make a signature and place it on a page.</Waiting>
  if (failed) return <Waiting actions={actions}>This PDF can't be shown here, so a signature can't be placed on it.</Waiting>
  if (!pages) return <Waiting actions={actions}>Reading the pages…</Waiting>

  const { PdfPage } = pdfHost
  const size = pages[Math.min(current, pages.length - 1)]
  const go = (by: number) => {
    const next = Math.min(pages.length - 1, Math.max(0, current + by))
    setCurrent(next)
    if (o.scope === 'page') onChange({ ...o, page: next })
  }
  const setScope = (scope: O['scope']) => {
    // show the page the signature will be on
    const at = scope === 'last' ? pages.length - 1 : current
    setCurrent(at)
    onChange({ ...o, scope, page: at })
  }
  const shown = pagesToSign(o, pages.length)
  const here = shown.includes(current)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="min-w-0 space-y-3 rounded-xl border border-line bg-surface p-4">
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
        <CropSurface
          rect={o.rect}
          onChange={(rect) => onChange({ ...o, rect })}
          dim={false}
          inside={here && preview ? <img src={preview} alt="" className="size-full object-contain" /> : undefined}
          className="mx-auto"
          style={{ aspectRatio: `${size.width} / ${size.height}`, width: `min(100%, calc(62vh * ${size.width / size.height}))` }}
        >
          <PdfPage key={current} file={file} page={current} renderWidth={900} />
        </CropSurface>
        <p className="text-xs text-muted">Drag on the page to draw the box for the signature, drag inside it to move it, or drag a corner to resize it. The signature fits inside the box.</p>
      </div>

      <div className="min-w-0 space-y-5 rounded-xl border border-line bg-surface p-4">
        <section aria-label="Your signature" className="space-y-2">
          <h3 className="text-sm font-medium">Your signature</h3>
          <SignaturePad onChange={(image) => onChange({ ...o, image })} />
        </section>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Put it on</legend>
          <label className={radio}>
            <input type="radio" name="sign-scope" checked={o.scope === 'last'} onChange={() => setScope('last')} className="mt-0.5" />
            <span>The last page</span>
          </label>
          <label className={radio}>
            <input type="radio" name="sign-scope" checked={o.scope === 'page'} onChange={() => setScope('page')} className="mt-0.5" />
            <span>One page<span className="block text-xs text-muted">The page you are looking at; use Previous and Next to choose.</span></span>
          </label>
          <label className={radio}>
            <input type="radio" name="sign-scope" checked={o.scope === 'all'} onChange={() => setScope('all')} className="mt-0.5" />
            <span>Every page<span className="block text-xs text-muted">In the same place on each.</span></span>
          </label>
          <button type="button" onClick={() => onChange({ ...o, rect: defaultRect })} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2">
            Reset position
          </button>
        </fieldset>

        <p className="text-sm text-muted" role="status">
          {!o.image ? 'Make a signature to place it.' : `The signature goes on ${shown.length === 1 ? `page ${shown[0] + 1}` : `${shown.length} pages`}.`}
        </p>
        {actions}
        <p className="text-xs text-muted">This puts a picture of your signature on the page, like signing a printout. It is not a digital signature with a certificate, so it does not prove who signed or detect later changes.</p>
      </div>
    </div>
  )
}

/** a message in place of the panel, with the run button still there (a file that can't be shown can still fail with a clear message) */
function Waiting({ children, actions }: { children: string; actions: PanelProps['actions'] }) {
  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{children}</p>
      {actions}
    </div>
  )
}
