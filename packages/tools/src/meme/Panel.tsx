import { useEffect, useRef, useState } from 'react'
import type { PanelProps } from '../panels.ts'
import { RangeField, inputClass } from '../fields.tsx'
import { captionPng } from './caption.ts'
import type { MemeOptions as O } from './run.ts'

export const defaultOptions: O = { top: '', bottom: '', size: 7, colour: '#ffffff', topPng: null, bottomPng: null }

const MAX_WIDTH = 4096

export function Panel({ options: o, onChange, files }: PanelProps<O>) {
  const file = files[0]
  const [width, setWidth] = useState<number | null>(null)
  const latest = useRef(o)
  latest.current = o
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })

  // captions are drawn as wide as the picture so they are placed 1:1
  useEffect(() => {
    setWidth(null)
    if (!file) return
    let live = true
    createImageBitmap(file).then(
      (b) => {
        if (live) setWidth(Math.min(MAX_WIDTH, b.width))
        b.close()
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [file])

  useEffect(() => {
    if (!width) return
    let live = true
    Promise.all([captionPng(o.top, width, o.size, o.colour), captionPng(o.bottom, width, o.size, o.colour)]).then(([topPng, bottomPng]) => live && onChange({ ...latest.current, topPng, bottomPng }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, o.top, o.bottom, o.size, o.colour])

  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Captions</legend>
      <label className="block space-y-1 text-sm">
        Top text
        <input type="text" value={o.top} maxLength={120} onChange={(e) => set({ top: e.target.value })} className={`${inputClass} w-full`} />
      </label>
      <label className="block space-y-1 text-sm">
        Bottom text
        <input type="text" value={o.bottom} maxLength={120} onChange={(e) => set({ bottom: e.target.value })} className={`${inputClass} w-full`} />
      </label>
      <RangeField label="Size" value={o.size} min={3} max={14} unit="%" onChange={(size) => set({ size })} />
      <label className="flex items-center gap-2 text-sm">
        Colour
        <input type="color" value={o.colour} onChange={(e) => set({ colour: e.target.value })} className="h-8 w-10 rounded border border-field bg-surface" />
      </label>
      <p className="text-xs text-muted">Letters are capitals with a black outline. Long captions wrap and shrink to fit.</p>
    </fieldset>
  )
}
