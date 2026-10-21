import { inputClass } from '../fields.tsx'
import { missingLetters } from './content.ts'
import { FONTS, type EraseItem, type LineEditItem, type PictureEditItem } from './items.ts'

const row = 'flex flex-wrap items-center gap-2 text-sm'
const small = 'rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-on-accent pointer-coarse:min-h-11'

/** a line of the page's own text */
export function LineProperties({ item: i, onItem, onEdit, fonts }: { item: LineEditItem; onItem: (p: Partial<LineEditItem>) => void; onEdit: () => void; fonts: string[] }) {
  if (i.deleted) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted">This line is taken out of the page.</p>
        <button type="button" className={small} onClick={() => onItem({ deleted: false })}>Put it back</button>
      </div>
    )
  }
  const missing = missingLetters(i)
  const own = i.font === 'own'
  const stand = FONTS.find((f) => f.name === i.lookalike)?.label ?? i.lookalike
  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1 text-sm">
        Text
        <input className={inputClass} value={i.text} onChange={(e) => onItem({ text: e.target.value })} />
      </label>
      <button type="button" onClick={onEdit} className={small}>Change it on the page</button>
      <label className={row}>
        Font
        <select className={`${inputClass} min-w-0 flex-1`} value={i.font} onChange={(e) => onItem({ font: e.target.value })}>
          <option value="own">Same as the PDF</option>
          {FONTS.map((f) => (
            <option key={f.name} value={f.name}>
              {f.label}
            </option>
          ))}
          {fonts.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      {own && !i.letters && <p className="text-xs text-warning">The PDF's font for this line can't be used again here, so the line will use {stand}.</p>}
      {own && i.letters && missing.length > 0 && (
        <p className="text-xs text-warning">
          The PDF's font for this line has only the letters the file used, and not {missing.slice(0, 6).map((c) => `“${c}”`).join(' ')}. The line will use {stand}.
        </p>
      )}
      {own && i.letters && !missing.length && <p className="text-xs text-muted">Shown in the PDF's own font. The editor shows it in {stand}.</p>}
      <div className={row}>
        <label className="flex items-center gap-2">
          Size
          <input type="number" min={2} max={200} step={0.5} value={+i.size.toFixed(2)} onChange={(e) => onItem({ size: Math.min(200, Math.max(2, Number(e.target.value) || i.originalSize)) })} className={`${inputClass} w-20`} />
        </label>
        <label className="flex items-center gap-2">
          Colour
          <input type="color" value={i.colour} onChange={(e) => onItem({ colour: e.target.value })} className="h-8 w-10 rounded border border-field bg-surface" />
        </label>
      </div>
      {!own || missing.length || !i.letters ? (
        <div className={row} role="group" aria-label="Style">
          <button type="button" className={small} aria-pressed={i.bold} onClick={() => onItem({ bold: !i.bold })}>Bold</button>
          <button type="button" className={small} aria-pressed={i.italic} onClick={() => onItem({ italic: !i.italic })}>Italic</button>
        </div>
      ) : null}
      <p className="text-xs text-muted">Each line is changed on its own: longer text runs on past the line's end, it doesn't move to the next line. Drag the line to move it.</p>
    </div>
  )
}

/** a picture of the page's own */
export function PictureProperties({ item: i, onItem, onReplace }: { item: PictureEditItem; onItem: (p: Partial<PictureEditItem>) => void; onReplace: () => void }) {
  if (i.deleted) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted">This picture is taken out of the page.</p>
        <button type="button" className={small} onClick={() => onItem({ deleted: false })}>Put it back</button>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className={row}>
        <button type="button" className={small} onClick={onReplace}>Replace…</button>
        {i.replace && <button type="button" className={small} onClick={() => onItem({ replace: undefined })}>Use the original</button>}
        {(i.box.x !== i.from.x || i.box.y !== i.from.y || i.box.w !== i.from.w || i.box.h !== i.from.h) && <button type="button" className={small} onClick={() => onItem({ box: i.from })}>Back to its place</button>}
      </div>
      <p className="text-xs text-muted">Drag it to move it; drag a corner to resize it (hold Shift to change its shape). A picture put in its place fills the same box.</p>
    </div>
  )
}

export function EraseProperties(_: { item: EraseItem }) {
  return <p className="text-sm text-muted">The text, shapes and pictures under this box are taken out of the file. This doesn't clean the rest of the file: for anything sensitive, use Redact PDF.</p>
}
