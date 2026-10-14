import { useEffect, useRef, useState } from 'react'
import type { ImageBuffer } from '@ream/image-core'
import { RangeField, inputClass } from '../fields.tsx'
import { CropSurface } from '../CropSurface.tsx'
import { withSide, type Rect } from '../rect.ts'
import type { PanelProps } from '../panels.ts'
import { applyAreas, defaultOptions, toArea, type BlurOptions as O } from './apply.ts'

export { defaultOptions }
export const placesActions = true

const SHOWN = 1400 // the picture is shown and worked on at most this wide; the saved file is made from the original
const MODES: { value: O['mode']; label: string; note: string }[] = [
  { value: 'pixelate', label: 'Pixelate', note: 'Blocks of colour. Hard to undo.' },
  { value: 'blur', label: 'Blur', note: 'Soft. A light blur can sometimes be sharpened back.' },
  { value: 'box', label: 'Cover', note: 'A solid box. The covered pixels are gone for good.' },
]

export function Panel({ options: o, onChange, files, actions }: PanelProps<O>) {
  const file = files[0]
  const [base, setBase] = useState<ImageBuffer | null>(null)
  const [full, setFull] = useState<{ w: number; h: number } | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const view = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    onChange(defaultOptions)
    setSelected(null)
    setBase(null)
    setFull(null)
    if (!file) return
    let live = true
    createImageBitmap(file).then(
      (bmp) => {
        if (!live) return bmp.close()
        const k = Math.min(1, SHOWN / bmp.width)
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(bmp.width * k))
        c.height = Math.max(1, Math.round(bmp.height * k))
        const g = c.getContext('2d', { willReadFrequently: true })!
        g.drawImage(bmp, 0, 0, c.width, c.height)
        setFull({ w: bmp.width, h: bmp.height })
        setBase(g.getImageData(0, 0, c.width, c.height))
        bmp.close()
      },
      () => {},
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // the same operations as the saved file, on the small copy
  useEffect(() => {
    const c = view.current
    if (!c || !base) return
    const shown = { width: base.width, height: base.height, data: base.data.slice() }
    applyAreas(shown, o)
    c.getContext('2d')!.putImageData(new ImageData(shown.data, shown.width, shown.height), 0, 0)
  }, [base, o])

  if (!file) {
    return (
      <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
        <p className="text-sm text-muted">Add a picture, then drag on it to choose what to hide.</p>
        {actions}
      </div>
    )
  }

  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  const current = selected === null ? null : (o.areas[selected] ?? null)
  const choose = (r: Rect) => {
    if (selected === null || !o.areas[selected]) {
      setSelected(o.areas.length)
      set({ areas: [...o.areas, r] })
    } else set({ areas: o.areas.map((a, i) => (i === selected ? r : a)) })
  }
  const remove = (i: number) => {
    set({ areas: o.areas.filter((_, j) => j !== i) })
    setSelected(null)
  }

  // numbers in pixels: the keyboard route to the same selection
  const px = current && full && toArea(current, full.w, full.h)
  const field = (key: keyof Rect, label: string) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        type="number"
        min={0}
        value={px ? px[key] : ''}
        disabled={!px}
        onChange={(e) => full && current && choose(withSide(current, key, (Math.floor(Number(e.target.value)) || 0) / (key === 'x' || key === 'w' ? full.w : full.h)))}
        aria-label={`${label} in pixels`}
        className={`${inputClass} w-full`}
      />
    </label>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
        <CropSurface rect={current} onChange={choose} dim={false} className="mx-auto flex w-fit max-w-full">
          {base ? <canvas ref={view} width={base.width} height={base.height} role="img" aria-label="The picture, with the chosen parts treated" className="block max-h-[60vh] max-w-full" /> : <div className="h-48 w-72 max-w-full" />}
          {o.areas.map((r, i) =>
            i === selected ? null : (
              <span key={i} className="pointer-events-none absolute border-2 border-dashed border-accent" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
            ),
          )}
        </CropSurface>
        <p className="mt-2 text-xs text-muted">Drag on the picture to choose a part. Drag inside it to move it, or a corner to resize.</p>
      </div>

      <div className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-4">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">What to do</legend>
          {MODES.map((m) => (
            <label key={m.value} className="flex items-start gap-2 text-sm">
              <input type="radio" name="blur-mode" checked={o.mode === m.value} onChange={() => set({ mode: m.value })} className="mt-1" />
              <span>
                {m.label}
                <span className="block text-xs text-muted">{m.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {o.mode === 'box' ? (
          <label className="flex items-center gap-2 text-sm">
            Colour
            <input type="color" value={o.colour} onChange={(e) => set({ colour: e.target.value })} className="h-8 w-10 rounded border border-field bg-surface" />
          </label>
        ) : (
          <RangeField label="Strength" value={o.strength} min={10} max={100} unit="%" onChange={(strength) => set({ strength })} />
        )}

        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Parts</span>
            {o.areas.map((_, i) => (
              <span key={i} className={`inline-flex items-center rounded-full border text-xs ${i === selected ? 'border-accent bg-accent-soft' : 'border-line'}`}>
                <button type="button" onClick={() => setSelected(i)} aria-pressed={i === selected} className="rounded-l-full py-1 pl-2.5 pr-1 focus-visible:outline-2 focus-visible:outline-accent">
                  Part {i + 1}
                </button>
                <button type="button" onClick={() => remove(i)} aria-label={`Remove part ${i + 1}`} className="rounded-r-full py-1 pl-1 pr-2 hover:text-danger focus-visible:outline-2 focus-visible:outline-accent">
                  ×
                </button>
              </span>
            ))}
            {!o.areas.length && <span className="text-muted">none yet</span>}
          </div>
          {o.areas.length > 0 && selected !== null && (
            <button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
              Add another part
            </button>
          )}
        </div>

        {px && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {field('x', 'Left')}
            {field('y', 'Top')}
            {field('w', 'Width')}
            {field('h', 'Height')}
          </div>
        )}
        {actions}
      </div>
    </div>
  )
}
