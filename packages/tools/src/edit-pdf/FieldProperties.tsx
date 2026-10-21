import { inputClass } from '../fields.tsx'
import type { FieldSettings } from './fields.ts'
import type { FieldItem } from './items.ts'

type Props = {
  item: FieldItem
  /** the other items of the same field (a radio group's buttons) */
  group: FieldItem[]
  /** names other fields have */
  taken: Set<string>
  /** change the field (all its items) */
  onField: (patch: Partial<FieldSettings>) => void
  /** change this item only */
  onItem: (patch: Partial<FieldItem>) => void
}

const row = 'flex flex-wrap items-center gap-2 text-sm'
const small = 'rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-on-accent pointer-coarse:min-h-11'
const DATES = ['dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd', 'd mmm yyyy']
export const FIELD_KIND: Record<FieldItem['type'], string> = { text: 'Text field', date: 'Date field', checkbox: 'Checkbox', radio: 'Radio button', dropdown: 'Dropdown', list: 'List box', signature: 'Signature box' }

/** the settings of a form field */
export function FieldProperties({ item: f, group, taken, onField, onItem }: Props) {
  const name = f.name.trim()
  const problem = !name ? 'Every field needs a name.' : taken.has(name) ? 'Another field has this name.' : !f.source && name.includes('.') ? "A field's name can't have a dot in it." : null
  const texty = f.type === 'text' || f.type === 'date' || f.type === 'dropdown' || f.type === 'list'
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{FIELD_KIND[f.type]}</p>
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input className={inputClass} value={f.name} onChange={(e) => onField({ name: e.target.value })} aria-invalid={!!problem} />
      </label>
      {problem && <p className="text-xs text-danger">{problem}</p>}
      {f.locked ? (
        <p className="text-xs text-muted">This field uses settings these tools can't change (rich text, several choices at once or a file). It can be moved, resized, renamed or deleted.</p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Help text
            <input className={inputClass} value={f.tooltip} onChange={(e) => onField({ tooltip: e.target.value })} placeholder="Shown when the pointer is over the field" />
          </label>
          <div className={row}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={f.required} onChange={(e) => onField({ required: e.target.checked })} /> Required
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={f.readOnly} onChange={(e) => onField({ readOnly: e.target.checked })} /> Read only
            </label>
          </div>

          {f.type === 'text' && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Text
                {f.multiline ? (
                  <textarea className={`${inputClass} min-h-20`} value={String(f.value)} onChange={(e) => onField({ value: e.target.value })} />
                ) : (
                  <input className={inputClass} value={String(f.value)} onChange={(e) => onField({ value: e.target.value })} />
                )}
              </label>
              <div className={row}>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={f.multiline} onChange={(e) => onField({ multiline: e.target.checked, comb: false })} /> Several lines
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={f.password} onChange={(e) => onField({ password: e.target.checked })} /> Password
                </label>
              </div>
              <div className={row}>
                <label className="flex items-center gap-2">
                  Most letters
                  <input type="number" min={0} max={9999} value={f.maxLength ?? ''} placeholder="Any" onChange={(e) => onField({ maxLength: Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : null, ...(Number(e.target.value) > 0 ? {} : { comb: false }) })} className={`${inputClass} w-20`} />
                </label>
                <label className="flex items-center gap-2" title="Each letter in a box of its own, as many boxes as the most letters">
                  <input type="checkbox" checked={f.comb} disabled={!f.maxLength || f.multiline} onChange={(e) => onField({ comb: e.target.checked })} /> Letter boxes
                </label>
              </div>
            </>
          )}
          {f.type === 'date' && (
            <label className={row}>
              Format
              <select className={inputClass} value={f.dateFormat} onChange={(e) => onField({ dateFormat: e.target.value })}>
                {[...new Set([f.dateFormat, ...DATES])].filter(Boolean).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          {f.type === 'checkbox' && (
            <label className={row}>
              <input type="checkbox" checked={f.value === true} onChange={(e) => onField({ value: e.target.checked })} /> Ticked
            </label>
          )}
          {f.type === 'radio' && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                This button's value
                <input className={inputClass} value={f.state} onChange={(e) => onItem({ state: e.target.value.replace(/[\s/#()<>[\]{}%]/g, '_') })} />
              </label>
              {group.some((g) => g !== f && g.state === f.state) && <p className="text-xs text-danger">Another button of this group has this value.</p>}
              <label className={row}>
                Chosen
                <select className={inputClass} value={String(f.value)} onChange={(e) => onField({ value: e.target.value })}>
                  <option value="">None</option>
                  {group.map((g) => (
                    <option key={g.id} value={g.state}>
                      {g.state}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted">With a radio button selected, the radio button tool adds to its group.</p>
            </>
          )}
          {(f.type === 'dropdown' || f.type === 'list') && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Choices, one per line
                <textarea
                  className={`${inputClass} min-h-24`}
                  value={f.options.map((o) => o.label || o.value).join('\n')}
                  onChange={(e) => onField({ options: e.target.value.split('\n').map((label) => ({ value: f.options.find((o) => (o.label || o.value) === label)?.value ?? label, label })) })}
                />
              </label>
              <label className={row}>
                Chosen
                <select className={inputClass} value={String(f.value)} onChange={(e) => onField({ value: e.target.value })}>
                  <option value="">None</option>
                  {f.options.filter((o) => o.value.trim()).map((o, k) => (
                    <option key={k} value={o.value}>
                      {o.label || o.value}
                    </option>
                  ))}
                </select>
              </label>
              {f.type === 'dropdown' && (
                <label className={row}>
                  <input type="checkbox" checked={f.editable} onChange={(e) => onField({ editable: e.target.checked })} /> People can type their own
                </label>
              )}
            </>
          )}

          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1 font-medium">Look</legend>
            {texty && (
              <>
                <div className={row}>
                  <label className="flex items-center gap-2">
                    Text size
                    <input type="number" min={0} max={72} value={f.fontSize} onChange={(e) => onField({ fontSize: Math.min(72, Math.max(0, Number(e.target.value) || 0)) })} className={`${inputClass} w-20`} />
                  </label>
                  <span className="text-xs text-muted">0 fits the box</span>
                </div>
                <div className={row} role="group" aria-label="Alignment">
                  {(['Left', 'Centre', 'Right'] as const).map((a, k) => (
                    <button key={a} type="button" className={small} aria-pressed={f.align === k} onClick={() => onField({ align: k as 0 | 1 | 2 })}>
                      {a}
                    </button>
                  ))}
                </div>
              </>
            )}
            {f.type !== 'signature' && (
              <label className="flex items-center gap-2">
                {texty ? 'Text colour' : 'Mark colour'}
                <input type="color" value={f.textColour} onChange={(e) => onField({ textColour: e.target.value })} className="h-8 w-10 rounded border border-field bg-surface" />
              </label>
            )}
            <div className={row}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={f.border !== null} onChange={(e) => onField({ border: e.target.checked ? '#000000' : null })} /> Border
              </label>
              {f.border !== null && (
                <>
                  <input type="color" aria-label="Border colour" value={f.border} onChange={(e) => onField({ border: e.target.value })} className="h-8 w-10 rounded border border-field bg-surface" />
                  <select aria-label="Border width" className={inputClass} value={f.borderWidth} onChange={(e) => onField({ borderWidth: Number(e.target.value) })}>
                    {[0.5, 1, 2, 3].map((w) => (
                      <option key={w} value={w}>
                        {w} pt
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
            <div className={row}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={f.background !== null} onChange={(e) => onField({ background: e.target.checked ? '#eef3ff' : null })} /> Background
              </label>
              {f.background !== null && <input type="color" aria-label="Background colour" value={f.background} onChange={(e) => onField({ background: e.target.value })} className="h-8 w-10 rounded border border-field bg-surface" />}
            </div>
          </fieldset>
          {texty && <p className="text-xs text-muted">Field text is drawn in Helvetica, which has Latin letters, digits and common symbols.</p>}
        </>
      )}
    </div>
  )
}
