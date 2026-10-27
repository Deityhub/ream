import { RangeField, inputClass } from '../fields.tsx'
import type { PanelProps } from '../panels.ts'
import { COLOR_STEPS, WIDTHS, defaultOptions, type AnimatedGifOptions as O } from './options.ts'

export { defaultOptions }

export function Panel({ options: o, onChange }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Timing</legend>
        <RangeField label="Each" value={o.delay} min={50} max={2000} step={50} unit=" ms" onChange={(delay) => set({ delay })} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="gif-loop" checked={o.loop === 'forever'} onChange={() => set({ loop: 'forever' })} />
            Loop forever
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="gif-loop" checked={o.loop === 'once'} onChange={() => set({ loop: 'once' })} />
            Play once
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={o.pingPong} onChange={(e) => set({ pingPong: e.target.checked })} />
            Play back and forth
          </label>
        </div>
        <p className="text-xs text-muted">Use the arrows above to set the order of the pictures.</p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Size</legend>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Width
            <select value={o.width} onChange={(e) => set({ width: Number(e.target.value) })} className={inputClass}>
              {WIDTHS.map((w) => (
                <option key={w} value={w}>
                  {w ? `${w} px` : 'Same as the first picture'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Pictures of a different shape
            <select value={o.fit} onChange={(e) => set({ fit: e.target.value as O['fit'] })} className={inputClass}>
              <option value="contain">Fit inside, with bars</option>
              <option value="cover">Fill the frame, cropping</option>
              <option value="stretch">Stretch</option>
            </select>
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Bars and gaps
            <select value={o.background} onChange={(e) => set({ background: e.target.value as O['background'] })} className={inputClass}>
              <option value="white">White</option>
              <option value="black">Black</option>
              <option value="transparent">Transparent</option>
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Quality</legend>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Colours per picture
            <select value={o.colors} onChange={(e) => set({ colors: Number(e.target.value) })} className={inputClass}>
              {COLOR_STEPS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={o.dither} onChange={(e) => set({ dither: e.target.checked })} />
            Smooth gradients (dithering)
          </label>
        </div>
        <p className="text-xs text-muted">GIF has at most 256 colours per picture. Fewer colours and no dithering make a smaller file.</p>
      </fieldset>
    </div>
  )
}
