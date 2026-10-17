import type { PanelProps } from '../panels.ts'
import { FontsPanel } from '../fonts/FontsPanel.tsx'
import type { PowerpointToPdfOptions as O } from './run.ts'

export const defaultOptions: O = { hidden: false, localFonts: [] }

export function Panel({ options: o, onChange, files, readOfficeFonts, readFontFile }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Slides</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={o.hidden} onChange={(e) => set({ hidden: e.target.checked })} />
        Include hidden slides
      </label>
      <FontsPanel file={files[0]} readOfficeFonts={readOfficeFonts} readFontFile={readFontFile} value={o.localFonts} onChange={(localFonts) => set({ localFonts })} />
      <p className="text-xs text-muted">
        Each slide becomes a page of its own size. Fonts are embedded: the file's own fonts when they are on this computer, added or downloaded; otherwise Calibri, Cambria, Arial, Times New Roman and Courier New become look-alikes with the same letter widths, and other fonts the closest of those, so lines can break a little differently. Letters none of them have (such as Chinese or Japanese) show as ?. Charts are drawn from the values saved with them (bar, column, line, area, pie, doughnut and scatter; other kinds are marked where they were). Shadows, glow, 3D, animations and notes are left out, and a few rare shapes are drawn as boxes.
      </p>
    </fieldset>
  )
}
