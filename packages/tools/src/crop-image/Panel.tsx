import { useEffect, useState } from 'react'
import { inputClass } from '../fields.tsx'
import { CropSurface } from '../CropSurface.tsx'
import { WHOLE, withSide } from '../rect.ts'
import type { PanelProps } from '../panels.ts'
import { cropBox, type CropOptions } from './box.ts'

export const defaultOptions: CropOptions = WHOLE
export const placesActions = true

export function Panel({ options: o, onChange, files, actions }: PanelProps<CropOptions>) {
  const file = files[0]
  const [url, setUrl] = useState<string | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    setSize(null)
    onChange(defaultOptions)
    if (!file) return setUrl(null)
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  if (!file || !url) {
    return (
      <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
        <p className="text-sm text-muted">Add an image, then drag on it to choose the area to keep.</p>
        {actions}
      </div>
    )
  }

  // numeric fields in pixels: the keyboard route to the same selection
  const px = size && cropBox(o, size.w, size.h)
  const setPx = (key: keyof CropOptions, value: number) => {
    if (size) onChange(withSide(o, key, value / (key === 'x' || key === 'w' ? size.w : size.h)))
  }
  const field = (key: keyof CropOptions, label: string) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        type="number"
        min={0}
        value={px?.[key] ?? ''}
        disabled={!px}
        onChange={(e) => setPx(key, Math.floor(Number(e.target.value)) || 0)}
        aria-label={`${label} in pixels`}
        className={`${inputClass} w-full`}
      />
    </label>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
        <CropSurface rect={o} onChange={onChange} className="mx-auto flex w-fit max-w-full">
        <img
          src={url}
          alt="The image to crop"
          draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="block max-h-[60vh] max-w-full"
        />
        </CropSurface>
      </div>
      <div className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-4">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {field('x', 'Left')}
          {field('y', 'Top')}
          {field('w', 'Width')}
          {field('h', 'Height')}
        </div>
        {px && <p className="text-sm text-muted">Keeping {px.w} × {px.h} px of {size.w} × {size.h}.</p>}
        {actions}
      </div>
    </div>
  )
}
