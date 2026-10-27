import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon.tsx'

/**
 * How big pages are shown: a factor of their actual size (1 = 100%, a point is 4/3 CSS pixels as in other viewers),
 * the width of the space they are in, or (where the whole page should be in view) the page fitted in the space.
 */
export type Zoom = number | 'width' | 'page'

const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]
const PX_PER_PT = 4 / 3

/** the CSS width of a page `width` points wide at a zoom, given the width (and for 'page' the height) it has room for */
export function zoomedWidth(zoom: Zoom, page: { width: number; height: number }, room: { width: number; height: number }): number {
  if (zoom === 'width') return room.width
  if (zoom === 'page') return Math.min(room.width, room.height * (page.width / page.height))
  return page.width * PX_PER_PT * zoom
}

/** pixels to render a page shown `css` pixels wide at: sharp on this screen, in steps so small changes don't redraw it */
export function renderWidthFor(css: number): number {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
  return Math.min(4000, Math.max(400, Math.ceil((css * dpr) / 200) * 200))
}

/** the content width of an element, kept up to date as it is resized; put the returned ref on the element */
export function useWidth(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => {
      const s = getComputedStyle(el)
      setW(el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, w]
}

const step = 'flex size-8 items-center justify-center rounded-md hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 pointer-coarse:size-11'
const mode = 'rounded-md px-2 py-1 text-xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-on-accent pointer-coarse:min-h-11'

/**
 * Zoom out, the zoom as a percentage, zoom in, and fit to width (and fit the page, where `fitPage`). `percent` is the
 * size pages are shown at now (for the fit modes it comes from the room they have), so stepping starts from what is seen.
 */
export function ZoomBar({ zoom, onChange, percent, fitPage = false }: { zoom: Zoom; onChange: (z: Zoom) => void; percent: number; fitPage?: boolean }) {
  const now = typeof zoom === 'number' ? zoom : percent / 100
  const out = [...STEPS].reverse().find((s) => s < now - 0.005)
  const into = STEPS.find((s) => s > now + 0.005)
  // keyboard shortcuts while the pointer or focus is in the page area would fight the browser's own zoom; buttons only
  return (
    <div role="group" aria-label="Zoom" className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-line p-0.5 text-sm">
      <button type="button" onClick={() => out !== undefined && onChange(out)} disabled={out === undefined} aria-label="Zoom out" className={step}>
        <Icon name="minus" className="size-4" />
      </button>
      <span className="min-w-12 text-center text-xs tabular-nums" aria-live="polite">
        {Math.round(percent)}%
      </span>
      <button type="button" onClick={() => into !== undefined && onChange(into)} disabled={into === undefined} aria-label="Zoom in" className={step}>
        <Icon name="plus" className="size-4" />
      </button>
      <button type="button" onClick={() => onChange('width')} aria-pressed={zoom === 'width'} className={mode}>
        Fit width
      </button>
      {fitPage && (
        <button type="button" onClick={() => onChange('page')} aria-pressed={zoom === 'page'} className={mode}>
          Fit page
        </button>
      )}
    </div>
  )
}

/** a zoom remembered while the component lives; a new file (`reset`) goes back to the starting zoom */
export function useZoom(start: Zoom, reset?: unknown): [Zoom, (z: Zoom) => void] {
  const [zoom, setZoom] = useState<Zoom>(start)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setZoom(start)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reset])
  return [zoom, setZoom]
}

