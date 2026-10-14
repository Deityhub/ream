import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { between, clamp, isWhole, type Point, type Rect } from './rect.ts'

const pct = (v: number) => `${v * 100}%`
type Drag = { mode: 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se'; start: Point; orig: Rect }

const CORNERS: { id: 'nw' | 'ne' | 'sw' | 'se'; style: CSSProperties }[] = [
  { id: 'nw', style: { left: 0, top: 0, cursor: 'nwse-resize' } },
  { id: 'ne', style: { left: '100%', top: 0, cursor: 'nesw-resize' } },
  { id: 'sw', style: { left: 0, top: '100%', cursor: 'nesw-resize' } },
  { id: 'se', style: { left: '100%', top: '100%', cursor: 'nwse-resize' } },
]

/**
 * Drag on the content to choose the area to keep; drag inside the selection to move it, or a corner to resize.
 * The children (a picture, a rendered page) fill the surface and decide its size.
 */
export function CropSurface({ rect: o, onChange, children, style, className = '' }: { rect: Rect; onChange: (r: Rect) => void; children: ReactNode; style?: CSSProperties; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)

  const at = (e: PointerEvent): Point => {
    const r = box.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }
  }
  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = at(e)
    const handle = (e.target as HTMLElement).dataset.handle as Drag['mode'] | undefined
    const inside = !isWhole(o) && p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h
    drag.current = { mode: handle ?? (inside ? 'move' : 'draw'), start: p, orig: o }
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = at(e)
    if (d.mode === 'draw') onChange(between(d.start, p))
    else if (d.mode === 'move') onChange({ ...d.orig, x: clamp(d.orig.x + p.x - d.start.x, 0, 1 - d.orig.w), y: clamp(d.orig.y + p.y - d.start.y, 0, 1 - d.orig.h) })
    else {
      // resizing: the corner opposite the dragged one stays put
      const anchor = { x: d.mode.includes('w') ? d.orig.x + d.orig.w : d.orig.x, y: d.mode.includes('n') ? d.orig.y + d.orig.h : d.orig.y }
      onChange(between(anchor, p))
    }
  }

  return (
    <div
      ref={box}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      className={`relative touch-none select-none overflow-hidden rounded-lg border border-line ${className}`}
      style={{ cursor: 'crosshair', ...style }}
    >
      {children}
      <div
        className="absolute border-2 border-accent"
        style={{ left: pct(o.x), top: pct(o.y), width: pct(o.w), height: pct(o.h), boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)', cursor: 'move' }}
      >
        {CORNERS.map((c) => (
          <span key={c.id} data-handle={c.id} className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-accent bg-surface" style={c.style} />
        ))}
      </div>
    </div>
  )
}
