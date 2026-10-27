import type { PanelProps } from '../panels.ts'
import { FontsPanel } from '../fonts/FontsPanel.tsx'
import { inputClass } from '../fields.tsx'
import { PAGE_SIZES } from '../images-to-pdf/sizes.ts'
import type { ExcelToPdfOptions as O } from './run.ts'

export const defaultOptions: O = { setup: 'file', paper: 'a4', orientation: 'auto', fit: 'width', gridlines: false, localFonts: [] }

export function Panel({ options: o, onChange, files, readOfficeFonts, readFontFile }: PanelProps<O>) {
  const set = (patch: Partial<O>) => onChange({ ...o, ...patch })
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium">Pages</legend>
      {(
        [
          ['file', 'As saved in the workbook', "Paper, direction, margins, scaling, print area, repeated rows and grid lines from Excel's Page Setup. A sheet that has none is fitted to the page width."],
          ['choose', 'Choose here', 'The same paper and direction for every sheet. The print area and repeated rows still apply.'],
        ] as const
      ).map(([v, label, help]) => (
        <label key={v} className="flex items-start gap-2 text-sm">
          <input type="radio" name="excel-setup" checked={o.setup === v} onChange={() => set({ setup: v })} className="mt-1" />
          <span>
            {label}
            <span className="block text-xs text-muted">{help}</span>
          </span>
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-sm">
        <label className="flex flex-wrap items-center gap-2">
          {o.setup === 'file' ? 'Paper when a sheet has none' : 'Paper'}
          <select value={o.paper} onChange={(e) => set({ paper: e.target.value as O['paper'] })} className={inputClass}>
            {Object.entries(PAGE_SIZES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        {o.setup === 'choose' && (
          <label className="flex items-center gap-2">
            Direction
            <select value={o.orientation} onChange={(e) => set({ orientation: e.target.value as O['orientation'] })} className={inputClass}>
              <option value="auto">Automatic</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
        )}
      </div>
      {o.setup === 'choose' && (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={o.fit === 'width'} onChange={(e) => set({ fit: e.target.checked ? 'width' : 'none' })} className="mt-1" />
            <span>
              Fit to page width
              <span className="block text-xs text-muted">Shrinks a wide sheet so all its columns are on one page. Off keeps the real size and continues on more pages.</span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={o.gridlines} onChange={(e) => set({ gridlines: e.target.checked })} />
            Print grid lines
          </label>
        </>
      )}
      <FontsPanel file={files[0]} readOfficeFonts={readOfficeFonts} readFontFile={readFontFile} value={o.localFonts} onChange={(localFonts) => set({ localFonts })} />
      <p className="text-xs text-muted">
        Fonts are embedded: the file's own fonts when they are on this computer, added or downloaded; otherwise Calibri, Cambria, Arial, Times New Roman and Courier New become look-alikes with the same letter widths, and other fonts the closest of those. Letters none of them have (such as Chinese or Japanese) show as ?. Pictures and charts are drawn where they sit (not EMF or WMF drawings; radar, bubble and stock charts are left out). Shapes and conditional formatting are not drawn, and formulas show the value saved in the file.
      </p>
    </fieldset>
  )
}
