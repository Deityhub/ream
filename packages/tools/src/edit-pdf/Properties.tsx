import type { ReactNode } from 'react'
import { Icon } from '@ream/ui'
import { inputClass } from '../fields.tsx'
import type { Style, Tool } from './Overlay.tsx'
import { FONTS, type FieldItem, type Item, type TextItem } from './items.ts'
import { FIELD_KIND, FieldProperties } from './FieldProperties.tsx'
import { EraseProperties, LineProperties, PictureProperties } from './ContentProperties.tsx'
import type { FieldSettings } from './fields.ts'
import type { InstalledFont } from '../fonts/book.ts'

type Props = {
  item: Item | null
  tool: Tool
  style: Style
  onStyle: (s: Style) => void
  onItem: (item: Item) => void
  onRemove: () => void
  onDuplicate: () => void
  onOrder: (by: 1 | -1) => void
  onEdit: () => void
  pageCount: number
  /** families of the font files added */
  fonts: string[]
  /** add a font file; gives the family it is listed under, or null when it can't be used */
  onAddFont?: (f: File) => Promise<string | null>
  /** form fields: the selected field's other items, names other fields have, and changes to the whole field */
  group: FieldItem[]
  taken: Set<string>
  onField: (patch: Partial<FieldSettings>) => void
  /** pick a picture to put in place of the selected one */
  onReplace: () => void
  groups: string[]
  onGroup: (target: string | null) => void
  /** the font files added or found for the PDF's families */
  added: InstalledFont[]
}

const row = 'flex flex-wrap items-center gap-2 text-sm'
const small = 'rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-on-accent pointer-coarse:min-h-11'
const KIND: Record<Item['kind'], string> = { text: 'Text', image: 'Picture', shape: 'Shape', line: 'Line', draw: 'Drawing', whiteout: 'Whiteout', markup: 'Text markup', note: 'Note', link: 'Link', field: 'Form field', textline: 'Line of text', picture: 'Picture', erase: 'Erased area' }

/** the settings of the selected item, or of the tool in hand when nothing is selected (what the next item starts with) */
export function Properties({ item, tool, style, onStyle, onItem, onRemove, onDuplicate, onOrder, onEdit, pageCount, fonts, onAddFont, group, taken, onField, onReplace, groups, onGroup, added }: Props) {
  if (!item) return <ToolDefaults tool={tool} style={style} onStyle={onStyle} fonts={fonts} onAddFont={onAddFont} />
  const set = (patch: Partial<Item>) => onItem({ ...item, ...patch } as Item)
  return (
    <section aria-label="Selected" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{KIND[item.kind]}</h3>
        <span className="ml-auto flex gap-1">
          {item.kind !== 'textline' && item.kind !== 'picture' && item.kind !== 'erase' && <IconButton label="Duplicate (Ctrl or Cmd+D)" icon="copy" onClick={onDuplicate} />}
          {item.kind !== 'field' && item.kind !== 'textline' && item.kind !== 'picture' && item.kind !== 'erase' && (
            <>
              <IconButton label="Bring forward" icon="forward" onClick={() => onOrder(1)} />
              <IconButton label="Send back" icon="forward" flip onClick={() => onOrder(-1)} />
            </>
          )}
          <IconButton label="Delete (Delete key)" icon="trash" onClick={onRemove} />
        </span>
      </div>
      {item.kind === 'text' && (
        <>
          <TextFields value={item} onChange={(p) => set(p)} fonts={fonts} onAddFont={onAddFont} />
          <button type="button" onClick={onEdit} className={small}>Change the text</button>
        </>
      )}
      {item.kind === 'image' && (
        <>
          <Opacity value={item.opacity} onChange={(opacity) => set({ opacity })} />
          <div className={row}>
            Turn
            <button type="button" className={small} onClick={() => set({ turns: ((item.turns + 3) % 4) as 0 | 1 | 2 | 3 })}>Left</button>
            <button type="button" className={small} onClick={() => set({ turns: ((item.turns + 1) % 4) as 0 | 1 | 2 | 3 })}>Right</button>
          </div>
          <p className="text-xs text-muted">Drag a corner to resize; hold Shift to change its shape.</p>
        </>
      )}
      {item.kind === 'shape' && <ShapeFields value={item} onChange={(p) => set(p)} />}
      {item.kind === 'line' && (
        <>
          <Colour label="Colour" value={item.colour} onChange={(colour) => set({ colour })} />
          <Width value={item.width} onChange={(width) => set({ width })} />
          <label className={row}>
            Arrow heads
            <select className={inputClass} value={item.arrow} onChange={(e) => set({ arrow: e.target.value as 'none' | 'end' | 'both' })}>
              <option value="none">None</option>
              <option value="end">At the end</option>
              <option value="both">At both ends</option>
            </select>
          </label>
          <Opacity value={item.opacity} onChange={(opacity) => set({ opacity })} />
        </>
      )}
      {item.kind === 'draw' && (
        <>
          <Colour label="Colour" value={item.colour} onChange={(colour) => set({ colour })} />
          <Width value={item.width} onChange={(width) => set({ width })} max={40} />
          <label className={row}>
            <input type="checkbox" checked={item.highlighter} onChange={(e) => set({ highlighter: e.target.checked })} /> Highlighter (see-through)
          </label>
        </>
      )}
      {item.kind === 'whiteout' && (
        <>
          <Colour label="Colour" value={item.colour} onChange={(colour) => set({ colour })} />
          <p className="text-xs text-muted">Whiteout covers what is under it; the text and pictures are still in the file. To remove them for good, use Redact PDF.</p>
        </>
      )}
      {item.kind === 'markup' && (
        <>
          <label className={row}>
            Kind
            <select className={inputClass} value={item.type} onChange={(e) => set({ type: e.target.value as 'highlight' | 'underline' | 'strike' })}>
              <option value="highlight">Highlight</option>
              <option value="underline">Underline</option>
              <option value="strike">Strike-through</option>
            </select>
          </label>
          <Colour label="Colour" value={item.colour} onChange={(colour) => set({ colour })} />
          {item.text && <p className="break-words text-xs text-muted">“{item.text}”</p>}
        </>
      )}
      {item.kind === 'note' && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Note
            <textarea className={`${inputClass} min-h-24`} value={item.text} onChange={(e) => set({ text: e.target.value })} placeholder="What the note says" />
          </label>
          <Colour label="Colour" value={item.colour} onChange={(colour) => set({ colour })} />
        </>
      )}
      {item.kind === 'link' && (
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 font-medium">Goes to</legend>
          <label className={row}>
            <input type="radio" name="link-kind" checked={item.target === null} onChange={() => set({ target: null })} /> A web address
          </label>
          {item.target === null && <input className={`${inputClass} w-full`} type="url" inputMode="url" placeholder="https://…" value={item.url} onChange={(e) => set({ url: e.target.value })} aria-label="Web address" />}
          <label className={row}>
            <input type="radio" name="link-kind" checked={item.target !== null} onChange={() => set({ target: 0, url: '' })} /> A page of this PDF
          </label>
          {item.target !== null && (
            <select className={inputClass} value={item.target} onChange={(e) => set({ target: Number(e.target.value) })} aria-label="Page">
              {Array.from({ length: pageCount }, (_, i) => (
                <option key={i} value={i}>
                  Page {i + 1}
                </option>
              ))}
            </select>
          )}
          {item.target === null && item.url && !/^(https?:|mailto:)/i.test(item.url) && <p className="text-xs text-warning">Web addresses start with https://, http:// or mailto:.</p>}
        </fieldset>
      )}
      {item.kind === 'field' && <FieldProperties item={item} group={group} taken={taken} onField={onField} onItem={(p) => set(p)} groups={groups} onGroup={onGroup} />}
      {item.kind === 'textline' && <LineProperties item={item} onItem={(p) => set(p)} onEdit={onEdit} fonts={fonts} added={added} />}
      {item.kind === 'picture' && <PictureProperties item={item} onItem={(p) => set(p)} onReplace={onReplace} />}
      {item.kind === 'erase' && <EraseProperties item={item} />}
      {!['markup', 'note', 'field', 'textline', 'picture', 'erase'].includes(item.kind) && (
        <label className={row}>
          <input type="checkbox" checked={!!item.everyPage} onChange={(e) => set({ everyPage: e.target.checked })} /> Put on every page
        </label>
      )}
    </section>
  )
}

function ToolDefaults({ tool, style, onStyle, fonts, onAddFont }: { tool: Tool; style: Style; onStyle: (s: Style) => void; fonts: string[]; onAddFont?: (f: File) => Promise<string | null> }) {
  const head = (text: string, body?: ReactNode) => (
    <section aria-label="Tool" className="space-y-3">
      <h3 className="text-sm font-medium">{text}</h3>
      {body}
    </section>
  )
  if (tool === 'select') return head('Nothing selected', <p className="text-sm text-muted">Click something on the page to change it, or pick a tool to add more.</p>)
  if (tool === 'text') return head('New text', <TextFields value={style.text} onChange={(p) => onStyle({ ...style, text: { ...style.text, ...p } })} fonts={fonts} onAddFont={onAddFont} />)
  if (tool === 'rect' || tool === 'ellipse') return head(tool === 'rect' ? 'New rectangle' : 'New ellipse', <ShapeFields value={style.shape} onChange={(p) => onStyle({ ...style, shape: { ...style.shape, ...p } })} />)
  if (tool === 'line' || tool === 'arrow')
    return head(tool === 'line' ? 'New line' : 'New arrow', (
      <>
        <Colour label="Colour" value={style.line.colour} onChange={(colour) => onStyle({ ...style, line: { ...style.line, colour } })} />
        <Width value={style.line.width} onChange={(width) => onStyle({ ...style, line: { ...style.line, width } })} />
      </>
    ))
  if (tool === 'pen' || tool === 'highlighter') {
    const s = style[tool]
    return head(tool === 'pen' ? 'Pen' : 'Highlighter pen', (
      <>
        <Colour label="Colour" value={s.colour} onChange={(colour) => onStyle({ ...style, [tool]: { ...s, colour } })} />
        <Width value={s.width} onChange={(width) => onStyle({ ...style, [tool]: { ...s, width } })} max={40} />
        <p className="text-xs text-muted">Each stroke you draw is one drawing you can move or delete.</p>
      </>
    ))
  }
  if (tool === 'whiteout') return head('Whiteout', <><Colour label="Colour" value={style.whiteout.colour} onChange={(colour) => onStyle({ ...style, whiteout: { colour } })} /><p className="text-xs text-muted">Covers what is under it without removing it. Redact PDF removes.</p></>)
  if (tool === 'highlight' || tool === 'underline' || tool === 'strike')
    return head('Mark text', (
      <>
        <Colour label="Colour" value={style.markup[tool]} onChange={(c) => onStyle({ ...style, markup: { ...style.markup, [tool]: c } })} />
        <p className="text-xs text-muted">Drag across the page's text. It stays a comment others can change.</p>
      </>
    ))
  if (tool === 'note') return head('Note', <><Colour label="Colour" value={style.note.colour} onChange={(colour) => onStyle({ ...style, note: { colour } })} /><p className="text-xs text-muted">Click where the note goes, then type it here.</p></>)
  if (tool.startsWith('field-')) {
    const type = tool.slice(6) as FieldItem['type']
    const how = type === 'checkbox' || type === 'radio' ? 'Click where it goes, or drag to make it bigger.' : 'Drag a box where it goes, or click for one of the usual size.'
    return head(`New ${FIELD_KIND[type].toLowerCase()}`, <p className="text-sm text-muted">{how}{type === 'radio' ? ' Each click adds a button to the group of the one selected; pick Select to start another group.' : ''} Its settings show here once it's placed.</p>)
  }
  if (tool === 'erase') return head('Erase area', <p className="text-sm text-muted">Drag a box: the text, shapes and pictures under it are taken out of the file when it's saved. For anything sensitive, use Redact PDF, which also cleans the rest of the file.</p>)
  if (tool === 'link') return head('Link', <p className="text-sm text-muted">Drag a box over what should be clickable, then choose where it goes.</p>)
  return head('Picture')
}

function TextFields({ value, onChange, fonts, onAddFont }: { value: Pick<TextItem, 'font' | 'size' | 'colour' | 'bold' | 'italic' | 'align' | 'spacing' | 'opacity'>; onChange: (p: Partial<TextItem>) => void; fonts: string[]; onAddFont?: (f: File) => Promise<string | null> }) {
  return (
    <div className="space-y-3">
      <label className={row}>
        Font
        <select
          className={`${inputClass} min-w-0 flex-1`}
          value={value.font}
          onChange={(e) => (e.target.value === '+' ? document.getElementById('edit-font-file')?.click() : onChange({ font: e.target.value }))}
        >
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
          {onAddFont && <option value="+">Add a font file…</option>}
        </select>
      </label>
      {onAddFont && (
        <input
          id="edit-font-file"
          type="file"
          accept=".ttf,.otf,.ttc,.woff,font/ttf,font/otf,font/collection,font/woff"
          className="sr-only"
          tabIndex={-1}
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            const family = f ? await onAddFont(f) : null
            if (family) onChange({ font: family })
          }}
        />
      )}
      <div className={row}>
        <label className="flex items-center gap-2">
          Size
          <input type="number" min={4} max={200} value={value.size} onChange={(e) => onChange({ size: Math.min(200, Math.max(4, Number(e.target.value) || 12)) })} className={`${inputClass} w-20`} />
        </label>
        <Colour label="Colour" value={value.colour} onChange={(colour) => onChange({ colour })} />
      </div>
      <div className={row} role="group" aria-label="Style and alignment">
        <button type="button" className={small} aria-pressed={value.bold} onClick={() => onChange({ bold: !value.bold })}>Bold</button>
        <button type="button" className={small} aria-pressed={value.italic} onClick={() => onChange({ italic: !value.italic })}>Italic</button>
        {(['left', 'center', 'right'] as const).map((a) => (
          <button key={a} type="button" className={small} aria-pressed={value.align === a} onClick={() => onChange({ align: a })}>
            {a === 'left' ? 'Left' : a === 'center' ? 'Centre' : 'Right'}
          </button>
        ))}
      </div>
      <label className={row}>
        Line spacing
        <select className={inputClass} value={value.spacing} onChange={(e) => onChange({ spacing: Number(e.target.value) })}>
          {[1, 1.15, 1.2, 1.5, 2].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <Opacity value={value.opacity} onChange={(opacity) => onChange({ opacity })} />
      <p className="text-xs text-muted">The bundled fonts have Latin, Greek and Cyrillic letters. For other scripts, add a font file that has them; scripts whose letters join (Arabic, Indic) don't show correctly.</p>
    </div>
  )
}

function ShapeFields({ value, onChange }: { value: { fill: string | null; stroke: string | null; width: number; opacity: number }; onChange: (p: { fill?: string | null; stroke?: string | null; width?: number; opacity?: number }) => void }) {
  return (
    <div className="space-y-3">
      <div className={row}>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.fill !== null} onChange={(e) => onChange({ fill: e.target.checked ? '#bfdbfe' : null })} /> Fill
        </label>
        {value.fill !== null && <input type="color" aria-label="Fill colour" value={value.fill} onChange={(e) => onChange({ fill: e.target.value })} className="h-8 w-10 rounded border border-field bg-surface" />}
      </div>
      <div className={row}>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.stroke !== null} onChange={(e) => onChange({ stroke: e.target.checked ? '#1f6feb' : null })} /> Outline
        </label>
        {value.stroke !== null && <input type="color" aria-label="Outline colour" value={value.stroke} onChange={(e) => onChange({ stroke: e.target.value })} className="h-8 w-10 rounded border border-field bg-surface" />}
      </div>
      {value.stroke !== null && <Width value={value.width} onChange={(width) => onChange({ width })} />}
      <Opacity value={value.opacity} onChange={(opacity) => onChange({ opacity })} />
    </div>
  )
}

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      {label}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 rounded border border-field bg-surface" />
    </label>
  )
}

function Width({ value, onChange, max = 20 }: { value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <label className={row}>
      Width
      <input type="range" min={0.5} max={max} step={0.5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1" />
      <span className="w-12 text-right tabular-nums">{value} pt</span>
    </label>
  )
}

function Opacity({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className={row}>
      Opacity
      <input type="range" min={10} max={100} step={5} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} className="flex-1" />
      <span className="w-12 text-right tabular-nums">{Math.round(value * 100)}%</span>
    </label>
  )
}

function IconButton({ label, icon, onClick, flip = false }: { label: string; icon: string; onClick: () => void; flip?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="flex size-8 items-center justify-center rounded-md hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:size-11">
      <Icon name={icon} className={`size-4 ${flip ? 'rotate-180' : ''}`} />
    </button>
  )
}
