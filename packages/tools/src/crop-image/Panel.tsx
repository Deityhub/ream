import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { inputClass } from '../fields.tsx'
import type { PanelProps } from '../panels.ts'
import { cropBox, type CropOptions } from './box.ts'

export const defaultOptions: CropOptions = { x: 0, y: 0, w: 1, h: 1 }

const MIN = 0.01
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
const pct = (v: number) => `${v * 100}%`
type Point = { x: number; y: number }
type Drag = { mode: 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se'; start: Point; orig: CropOptions }

/** rectangle spanning two corner points, kept inside the image and at least MIN wide and tall */
function between(a: Point, b: Point): CropOptions {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x: Math.min(x, 1 - MIN), y: Math.min(y, 1 - MIN), w: clamp(Math.abs(a.x - b.x), MIN, 1 - x), h: clamp(Math.abs(a.y - b.y), MIN, 1 - y) }
}

export function Panel({ options: o, onChange, files }: PanelProps<CropOptions>) {
  const file = files[0]
  const [url, setUrl] = useState<string | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)

  useEffect(() => {
    setSize(null)
    onChange(defaultOptions)
    if (!file) return setUrl(null)
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  if (!file || !url) return <p className="text-sm text-muted">Add an image, then drag on it to choose the area to keep.</p>

  const at = (e: PointerEvent): Point => {
    const r = box.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) }
  }
  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = at(e)
    const handle = (e.target as HTMLElement).dataset.handle as Drag['mode'] | undefined
    const whole = o.w >= 0.999 && o.h >= 0.999
    const inside = !whole && p.x >= o.x && p.x <= o.x + o.w && p.y >= o.y && p.y <= o.y + o.h
    drag.current = { mode: handle ?? (inside ? 'move' : 'draw'), start: p, orig: o }
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = at(e)
    if (d.mode === 'draw') onChange(between(d.start, p))
    else if (d.mode === 'move') {
      onChange({ ...d.orig, x: clamp(d.orig.x + p.x - d.start.x, 0, 1 - d.orig.w), y: clamp(d.orig.y + p.y - d.start.y, 0, 1 - d.orig.h) })
    } else {
      // resizing: the corner opposite the dragged one stays put
      const anchor = { x: d.mode.includes('w') ? d.orig.x + d.orig.w : d.orig.x, y: d.mode.includes('n') ? d.orig.y + d.orig.h : d.orig.y }
      onChange(between(anchor, p))
    }
  }

  // numeric fields in pixels: the keyboard route to the same selection
  const px = size && cropBox(o, size.w, size.h)
  const setPx = (key: keyof CropOptions, value: number) => {
    if (!size) return
    const frac = value / (key === 'x' || key === 'w' ? size.w : size.h)
    const next = { ...o }
    if (key === 'x') next.x = clamp(frac, 0, 1 - MIN)
    else if (key === 'y') next.y = clamp(frac, 0, 1 - MIN)
    else if (key === 'w') next.w = clamp(frac, MIN, 1 - o.x)
    else next.h = clamp(frac, MIN, 1 - o.y)
    next.w = Math.min(next.w, 1 - next.x)
    next.h = Math.min(next.h, 1 - next.y)
    onChange(next)
  }
  const field = (key: keyof CropOptions, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      {label}
      <input
        type="number"
        min={0}
        value={px?.[key] ?? ''}
        disabled={!px}
        onChange={(e) => setPx(key, Math.floor(Number(e.target.value)) || 0)}
        aria-label={`${label} in pixels`}
        className={`${inputClass} w-24`}
      />
    </label>
  )
  const corners: { id: 'nw' | 'ne' | 'sw' | 'se'; style: React.CSSProperties }[] = [
    { id: 'nw', style: { left: 0, top: 0, cursor: 'nwse-resize' } },
    { id: 'ne', style: { left: '100%', top: 0, cursor: 'nesw-resize' } },
    { id: 'sw', style: { left: 0, top: '100%', cursor: 'nesw-resize' } },
    { id: 'se', style: { left: '100%', top: '100%', cursor: 'nwse-resize' } },
  ]

  return (
    <div className="space-y-3">
      <div
        ref={box}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        className="relative inline-block max-w-full touch-none select-none overflow-hidden rounded-lg border border-line"
        style={{ cursor: 'crosshair' }}
      >
        <img
          src={url}
          alt="The image to crop"
          draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="block max-h-[60vh] max-w-full"
        />
        <div
          className="absolute border-2 border-accent"
          style={{ left: pct(o.x), top: pct(o.y), width: pct(o.w), height: pct(o.h), boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)', cursor: 'move' }}
        >
          {corners.map((c) => (
            <span
              key={c.id}
              data-handle={c.id}
              className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-accent bg-surface"
              style={c.style}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {field('x', 'Left')}
        {field('y', 'Top')}
        {field('w', 'Width')}
        {field('h', 'Height')}
      </div>
      {px && <p className="text-sm text-muted">Keeping {px.w} × {px.h} px of {size.w} × {size.h}.</p>}
    </div>
  )
}
