import { useEffect, useRef, useState } from 'react'
import { Icon } from '@ream/ui'
import type { PanelProps } from '../panels.ts'
import { RangeField, SpotPicker, inputClass } from '../fields.tsx'
import { pictureMark, textMark } from '../bitmaps.ts'
import type { WatermarkImageOptions as O } from './run.ts'

export const defaultOptions: O = {
  mark: null,
  source: 'text',
  text: 'SAMPLE',
  bold: true,
  italic: false,
  colour: '#ffffff',
  angle: 0,
  opacity: 50,
  size: 40,
  layout: 'single',
  spot: 'mc',
  margin: 3,
  spacing: 40,
}

const FAMILY = '"Manrope Variable", Manrope, system-ui, sans-serif'

export function Panel({ options: o, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  const [logo, setLogo] = useState<File | null>(null)
  const latest = useRef(o)
  latest.current = o

  // the mark is made here (the browser has the fonts); the run only receives the finished picture
  useEffect(() => {
    let live = true
    const make = o.source === 'logo' ? (logo ? pictureMark(logo, o.angle) : Promise.resolve(null)) : textMark(o.text, { family: FAMILY, bold: o.bold, italic: o.italic, colour: o.colour }, o.angle)
    make.then((mark) => live && onChange({ ...latest.current, mark }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.source, o.text, o.bold, o.italic, o.colour, o.angle, logo])

  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Watermark</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="wmi-source" checked={o.source === 'text'} onChange={() => set({ source: 'text' })} />
          Text
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="wmi-source" checked={o.source === 'logo'} onChange={() => set({ source: 'logo' })} />
          Logo or picture
        </label>
      </div>

      {o.source === 'text' ? (
        <>
          <label className="block space-y-1 text-sm">
            Text
            <input type="text" value={o.text} maxLength={80} onChange={(e) => set({ text: e.target.value })} className={`${inputClass} w-full`} />
          </label>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              Colour
              <input type="color" value={o.colour} onChange={(e) => set({ colour: e.target.value })} className="h-8 w-10 rounded border border-field bg-surface" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={o.bold} onChange={(e) => set({ bold: e.target.checked })} /> Bold
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={o.italic} onChange={(e) => set({ italic: e.target.checked })} /> Italic
            </label>
          </div>
        </>
      ) : (
        <div className="space-y-1">
          {/* the native file control is hidden; this looks and acts like a button, and shows what was chosen */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
              <Icon name="upload" className="size-4" />
              {logo ? 'Choose another picture' : 'Choose a logo'}
              <input type="file" accept="image/*" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} className="sr-only" />
            </label>
            {logo && <span className="min-w-0 truncate text-sm text-muted">{logo.name}</span>}
          </div>
          {!logo && <p className="text-xs text-muted">A PNG with a see-through background works best.</p>}
        </div>
      )}

      <RangeField label="Size" value={o.size} min={5} max={100} unit="%" onChange={(size) => set({ size })} />
      <RangeField label="Opacity" value={o.opacity} min={5} max={100} unit="%" onChange={(opacity) => set({ opacity })} />
      <RangeField label="Angle" value={o.angle} min={-90} max={90} step={5} unit="°" onChange={(angle) => set({ angle })} />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="wmi-layout" checked={o.layout === 'single'} onChange={() => set({ layout: 'single' })} />
          One mark
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="wmi-layout" checked={o.layout === 'tile'} onChange={() => set({ layout: 'tile' })} />
          Repeat over the picture
        </label>
      </div>
      {o.layout === 'tile' ? (
        <RangeField label="Spacing" value={o.spacing} min={0} max={200} step={5} unit="%" onChange={(spacing) => set({ spacing })} />
      ) : (
        <>
          <div className="space-y-1 text-sm">
            <span className="block">Position</span>
            <SpotPicker label="Position on the picture" value={o.spot} onChange={(spot) => set({ spot })} />
          </div>
          <RangeField label="Margin" value={o.margin} min={0} max={20} unit="%" onChange={(margin) => set({ margin })} />
        </>
      )}
      <p className="text-xs text-muted">Every picture you add gets the same mark, sized to its own width.</p>
    </fieldset>
  )
}
