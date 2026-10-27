import { ZoomBar, renderWidthFor, useWidth, useZoom, zoomedWidth, type Zoom } from '@ream/ui'

/** the share of the window's height a page fitted whole may take (the panels' controls sit beside or below it) */
const PAGE_ROOM = 0.62

/**
 * Zoom for a panel that works on one page at a time: `scroller` goes on the scrolling area around the page, `width`
 * (CSS pixels) on the page box, `renderWidth` to the page picture. Starts with the whole page in view; a new file
 * (`reset`) starts there again.
 */
export function usePageZoom(size: { width: number; height: number } | undefined, reset: unknown, start: Zoom = 'page') {
  const [zoom, setZoom] = useZoom(start, reset)
  const [scroller, room] = useWidth()
  const height = typeof window === 'undefined' ? 800 : window.innerHeight * PAGE_ROOM
  const width = size && room ? zoomedWidth(zoom, size, { width: room, height }) : 0
  const percent = size && width ? (width / (size.width * (4 / 3))) * 100 : 100
  return {
    scroller,
    width,
    renderWidth: renderWidthFor(width || 900),
    bar: <ZoomBar zoom={zoom} onChange={setZoom} percent={percent} fitPage />,
  }
}
