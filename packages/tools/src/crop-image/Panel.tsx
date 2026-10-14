import { useEffect, useState } from 'react'
import { inputClass } from '../fields.tsx'
import { CropSurface } from '../CropSurface.tsx'
import { WHOLE, withSide } from '../rect.ts'
import type { PanelProps } from '../panels.ts'
import { cropBox, type CropOptions } from './box.ts'

export const defaultOptions: CropOptions = WHOLE

export function Panel({ options: o, onChange, files }: PanelProps<CropOptions>) {
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

  if (!file || !url) return <p className="text-sm text-muted">Add an image, then drag on it to choose the area to keep.</p>

  // numeric fields in pixels: the keyboard route to the same selection
  const px = size && cropBox(o, size.w, size.h)
  const setPx = (key: keyof CropOptions, value: number) => {
    if (size) onChange(withSide(o, key, value / (key === 'x' || key === 'w' ? size.w : size.h)))
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

  return (
    <div className="space-y-3">
      <CropSurface rect={o} onChange={onChange} className="inline-block max-w-full">
        <img
          src={url}
          alt="The image to crop"
          draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="block max-h-[60vh] max-w-full"
        />
      </CropSurface>
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
