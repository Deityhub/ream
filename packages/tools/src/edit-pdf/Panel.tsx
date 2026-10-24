import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@ream/ui'
import type { PanelProps } from '../panels.ts'
import { usePageZoom } from '../PageZoom.tsx'
import { FontsPanel } from '../fonts/FontsPanel.tsx'
import { Overlay, type Style, type Tool } from './Overlay.tsx'
import { Properties } from './Properties.tsx'
import { canStep, layerOf, moved, pickText as pickFrom, stepOrder } from './geometry.ts'
import { byPosition, copiedField, fieldItems, joinGroup, suggestedFields, type FieldSettings } from './fields.ts'
import { detectFields } from './detect.ts'
import { defaultOptions, isContent, isField, itemsOn, type EditPdfOptions as O, type FieldItem, type Item, type PictureEditItem } from './items.ts'
import { lineChanged, lineItem, liveChars, pictureChanged, type PageContent } from './content.ts'
import { measurer } from './viewFonts.ts'
import type { Rect } from '../rect.ts'

export { defaultOptions }
export const placesActions = true

type Size = { width: number; height: number }

const START: Style = {
  text: { font: 'Arial', size: 14, colour: '#111111', bold: false, italic: false, align: 'left', spacing: 1.2, opacity: 1 },
  shape: { fill: null, stroke: '#1f6feb', width: 2, opacity: 1 },
  line: { colour: '#1f6feb', width: 2, opacity: 1 },
  pen: { colour: '#1f2937', width: 2 },
  highlighter: { colour: '#facc15', width: 14 },
  whiteout: { colour: '#ffffff' },
  markup: { highlight: '#fde047', underline: '#2563eb', strike: '#dc2626' },
  note: { colour: '#fde68a' },
}

const TOOLS: { tool: Tool; label: string; icon: string; key?: string }[] = [
  { tool: 'select', label: 'Select and move', icon: 'cursor', key: 'v' },
  { tool: 'text', label: 'Text', icon: 'type', key: 't' },
  { tool: 'image', label: 'Picture', icon: 'image' },
  { tool: 'rect', label: 'Rectangle', icon: 'square', key: 'r' },
  { tool: 'ellipse', label: 'Ellipse', icon: 'circle', key: 'o' },
  { tool: 'line', label: 'Line', icon: 'line', key: 'l' },
  { tool: 'arrow', label: 'Arrow', icon: 'arrow', key: 'a' },
  { tool: 'pen', label: 'Pen', icon: 'pen', key: 'p' },
  { tool: 'highlighter', label: 'Highlighter pen', icon: 'highlighter' },
  { tool: 'whiteout', label: 'Whiteout', icon: 'whiteout' },
  { tool: 'highlight', label: 'Highlight text', icon: 'highlight' },
  { tool: 'underline', label: 'Underline text', icon: 'underline' },
  { tool: 'strike', label: 'Strike through text', icon: 'strike' },
  { tool: 'note', label: 'Note', icon: 'note' },
  { tool: 'link', label: 'Link', icon: 'link' },
]

const FIELD_TOOLS: { tool: Tool; label: string; icon: string; key?: string }[] = [
  { tool: 'select', label: 'Select and move', icon: 'cursor' },
  { tool: 'field-text', label: 'Text field', icon: 'field-text' },
  { tool: 'field-checkbox', label: 'Checkbox', icon: 'field-check' },
  { tool: 'field-radio', label: 'Radio button', icon: 'field-radio' },
  { tool: 'field-dropdown', label: 'Dropdown', icon: 'field-dropdown' },
  { tool: 'field-list', label: 'List box', icon: 'field-list' },
  { tool: 'field-date', label: 'Date field', icon: 'field-date' },
  { tool: 'field-signature', label: 'Signature box', icon: 'field-sign' },
]
const CONTENT_TOOLS: { tool: Tool; label: string; icon: string; key?: string }[] = [
  { tool: 'select', label: 'Select and move', icon: 'cursor' },
  { tool: 'erase', label: 'Erase area', icon: 'eraser' },
]
type Mode = 'add' | 'content' | 'forms'
const MODES: [Mode, string][] = [['add', 'Add to pages'], ['content', 'Edit content'], ['forms', 'Form fields']]

// tools that stay in hand after placing something, for placing several in a row
const KEEP: Tool[] = ['pen', 'highlighter', 'highlight', 'underline', 'strike', 'field-radio']

const button = 'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 pointer-coarse:min-h-11'
const iconButton = 'flex size-8 items-center justify-center rounded-md hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 aria-pressed:bg-accent aria-pressed:text-on-accent pointer-coarse:size-11'
const HISTORY = 200

export function Panel({ options: o, onChange, files, pdfHost, actions, readFontFile }: PanelProps<O>) {
  const file = files[0]
  const [pages, setPages] = useState<Size[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [current, setCurrent] = useState(0)
  const [tool, setTool] = useState<Tool>('select')
  const [style, setStyle] = useState<Style>(START)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<Mode>('add')
  /** the pages' own lines and pictures, read when the content mode first shows each page */
  const [content, setContent] = useState<Map<number, PageContent | 'failed'>>(new Map())
  const pageBox = useRef<HTMLDivElement>(null)
  const replacer = useRef<HTMLInputElement>(null)
  const [formNote, setFormNote] = useState('')
  /** the fields picked so far while setting the Tab order (null when not setting it) */
  const [ordering, setOrdering] = useState<string[] | null>(null)
  const [finding, setFinding] = useState(false)
  /** a line or picture of the page being dragged: its old place goes at the first move, not at the drop */
  const [dragging, setDragging] = useState<string | null>(null)
  const [found, setFound] = useState('')
  const past = useRef<Item[][]>([])
  const future = useRef<Item[][]>([])
  const clipboard = useRef<Item | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const latest = useRef(o)
  latest.current = o
  const counter = useRef(0)
  const newId = useCallback(() => `i${Date.now().toString(36)}${(counter.current++).toString(36)}`, [])

  useEffect(() => {
    setPages(null)
    setFailed(false)
    setCurrent(0)
    setSelected(null)
    setEditing(null)
    setOrdering(null)
    setFormNote('')
    setFound('')
    setContent(new Map())
    past.current = []
    future.current = []
    onChange(defaultOptions)
    if (!file || !pdfHost) return
    let live = true
    pdfHost.pages(file).then(
      (p) => live && setPages(p),
      () => live && setFailed(true),
    )
    // the file's own form fields, so they can be changed like anything added
    pdfHost.form(file).then(
      (info) => {
        if (!live) return
        const fields = fieldItems(info, newId)
        if (fields.length) onChange({ ...latest.current, items: [...latest.current.items, ...fields], fieldsLoaded: fields })
        if (info.xfa) setFormNote('This PDF also has an XFA form, which these tools can neither show nor change. Viewers that use it may ignore the fields set up here.')
      },
      () => {},
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  useEffect(() => {
    if (mode === 'forms' || !file || !pdfHost?.content || content.has(current)) return
    let live = true
    pdfHost.content(file, current).then(
      (c) => live && setContent((m) => new Map(m).set(current, c)),
      () => live && setContent((m) => new Map(m).set(current, 'failed')),
    )
    return () => {
      live = false
    }
  }, [mode, current, file, content, pdfHost])

  const zoom = usePageZoom(pages ? pages[Math.min(current, pages.length - 1)] : undefined, file)
  // shortcuts work wherever the focus is while the editor is open (clicking the page leaves it on the document), except in fields
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  if (!file || !pdfHost) return <Waiting actions={actions}>Add a PDF, then add text, pictures, shapes, drawings and comments on its pages.</Waiting>
  if (failed) return <Waiting actions={actions}>This PDF can't be shown here, so it can't be edited on its pages.</Waiting>
  if (!pages) return <Waiting actions={actions}>Reading the pages…</Waiting>

  const { PdfPage } = pdfHost
  const size = pages[Math.min(current, pages.length - 1)]
  const items = o.items

  // every change to the items is one step that can be undone
  const commit = (next: Item[], select?: string | null) => {
    past.current = [...past.current.slice(-HISTORY + 1), latest.current.items]
    future.current = []
    onChange({ ...latest.current, items: next })
    if (select !== undefined) setSelected(select)
    setNote('')
    setFound('')
  }
  const undo = () => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(latest.current.items)
    onChange({ ...latest.current, items: prev })
    setSelected(null)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(latest.current.items)
    onChange({ ...latest.current, items: next })
    setSelected(null)
  }
  const sel = items.find((i) => i.id === selected) ?? null
  const update = (item: Item) => {
    const was = items.find((i) => i.id === item.id)
    // a radio button that was the chosen one stays chosen under its new value
    const follow = was && isField(was) && isField(item) && was.state !== item.state && was.value === was.state
    commit(items.map((i) => (i.id === item.id ? item : follow && isField(i) && i.name === item.name ? { ...i, value: item.state } : i)))
  }
  const fields = items.filter(isField)
  // a change to a field's settings goes to every place it is shown
  const updateField = (item: FieldItem, patch: Partial<FieldSettings>) => commit(items.map((i) => (isField(i) && i.name === item.name ? { ...i, ...patch } : i)))
  const remove = (id: string) => {
    const it = items.find((i) => i.id === id)
    // the page's own line or picture is marked as taken out: forgetting the item would bring it back
    if (it && (it.kind === 'textline' || it.kind === 'picture')) commit(items.map((i) => (i.id === id ? ({ ...i, deleted: true } as Item) : i)))
    else commit(items.filter((i) => i.id !== id), null)
  }
  const duplicate = (item: Item, page = item.page, offset = 0.02) => {
    if (isContent(item)) return
    const shifted = { ...moved(item, offset, offset), page } as Item
    const copy = isField(shifted) ? copiedField(shifted, newId(), fields) : ({ ...shifted, id: newId() } as Item)
    commit([...items, copy], copy.id)
  }
  const reorder = (id: string, by: 1 | -1) => {
    if (canStep(items, id, by)) return commit(stepOrder(items, id, by))
    // nothing to pass: say so, rather than a button that looks broken
    const comment = layerOf(items.find((i) => i.id === id)!) === 'comments'
    setNote(
      by === 1
        ? comment ? 'Already in front of the other comments. Comments always stay in front of what was added.' : 'Already in front of everything added to this page.'
        : comment ? 'Already behind the other comments. Comments always stay in front of what was added; a highlight darkens what is under it instead of covering it.' : "Already behind everything added to this page. The page's own text and pictures are behind it.",
    )
  }
  const go = (by: number) => {
    setCurrent((c) => Math.min(pages.length - 1, Math.max(0, c + by)))
    setSelected(null)
    setEditing(null)
  }
  const choose = (t: Tool) => {
    setEditing(null)
    if (t === 'image') {
      picker.current?.click()
      return
    }
    setTool(t)
    setOrdering(null)
    if (t !== 'select') setSelected(null)
  }
  const switchMode = (m: Mode) => {
    setMode(m)
    setTool('select')
    setSelected(null)
    setEditing(null)
    setOrdering(null)
  }
  const here = itemsOn(items, current)
  const pageFields = here.filter(isField)
  const tabNow = (o.tabOrder[current] ?? []).filter((id) => pageFields.some((f) => f.id === id))
  const orderNow = [...tabNow, ...pageFields.map((f) => f.id).filter((id) => !tabNow.includes(id))]
  const setOrder = (ids: string[]) => onChange({ ...latest.current, tabOrder: { ...latest.current.tabOrder, [current]: ids } })
  const finishOrder = () => {
    if (ordering?.length) setOrder([...ordering, ...orderNow.filter((id) => !ordering.includes(id))])
    setOrdering(null)
  }

  // a picture: placed in the middle of the page at a usual size, its shape kept
  const addPicture = async (f: File) => {
    try {
      const { data, type, width, height } = await pictureOf(f)
      const w = Math.min(0.5, (width / size.width) * 0.75)
      const h = (w * size.width * (height / width)) / size.height
      const id = newId()
      commit([...items, { id, page: current, kind: 'image', box: { x: (1 - w) / 2, y: Math.max(0, (1 - h) / 2), w, h: Math.min(1, h) }, data, type, turns: 0, opacity: 1 }], id)
      setTool('select')
    } catch {
      setNote(`${f.name} can't be read as a picture. PNG, JPEG, WebP and GIF pictures work.`)
    }
  }

  keys.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (target.closest?.('input, textarea, select, [contenteditable], dialog')) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      redo()
    } else if (mod && e.key.toLowerCase() === 'd' && sel) {
      e.preventDefault()
      duplicate(sel)
    } else if (mod && e.key.toLowerCase() === 'c' && sel) clipboard.current = sel
    else if (mod && e.key.toLowerCase() === 'v' && clipboard.current) {
      e.preventDefault()
      duplicate(clipboard.current, current, clipboard.current.page === current ? 0.02 : 0)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
      e.preventDefault()
      remove(sel.id)
    } else if (e.key === 'Escape') {
      setSelected(null)
      setTool('select')
      finishOrder()
    } else if (e.key.startsWith('Arrow') && sel) {
      e.preventDefault()
      const step = (e.shiftKey ? 10 : 1) / zoom.width
      const [dx, dy] = e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step * (size.width / size.height)] : [0, step * (size.width / size.height)]
      update(moved(sel, dx, dy))
    } else if (!mod && !e.altKey && mode === 'add') {
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase())
      if (t) choose(t.tool)
    }
  }

  // fields where the pages' underscores, lines and boxes are; one undo step for all of them
  const find = async (which: number[]) => {
    if (!pdfHost.layout) return
    setFinding(true)
    try {
      const added: FieldItem[] = []
      for (const p of which) {
        const layout = await pdfHost.layout(file, p)
        const have = [...fields, ...added]
        added.push(...suggestedFields(detectFields(layout, have.filter((f) => f.page === p).map((f) => f.box)), p, have, newId))
      }
      if (added.length) commit([...latest.current.items, ...added], null)
      if (added.length) setFound(`${added.length} ${added.length === 1 ? 'field' : 'fields'} added. Check them, and delete any that aren't wanted.`)
      else setNote("No places for fields were found. They are found from underscores, dotted lines, lines and boxes in the page's text; a scanned page has none.")
    } catch {
      setNote("This page's text can't be read, so no fields were found.")
    } finally {
      setFinding(false)
    }
  }

  const pageContent = (() => {
    const c = content.get(current)
    return c && c !== 'failed' ? c : null
  })()
  // the page's own line or picture becomes an item when it is first picked
  const pick = (kind: 'line' | 'picture', id: number, edit: boolean) => {
    if (!pageContent) return
    const have = items.find((i) => i.page === current && ((kind === 'line' && i.kind === 'textline') || (kind === 'picture' && i.kind === 'picture')) && (i as { source: number }).source === id)
    if (have) {
      setSelected(have.id)
      if (edit) setEditing(have.id)
      return
    }
    if (kind === 'line') {
      const l = pageContent.lines.find((x) => x.id === id)
      if (!l) return
      const it = lineItem(newId(), current, l)
      commit([...items, it], it.id)
      if (edit) setEditing(it.id)
    } else {
      const p = pageContent.pictures.find((x) => x.id === id)
      if (!p) return
      const it: PictureEditItem = { id: newId(), page: current, kind: 'picture', source: id, from: p.box, box: p.box, preview: cropOf(pageBox.current, p.box) }
      commit([...items, it], it.id)
    }
  }

  const pickText = pdfHost.chars
    ? async (area: { x: number; y: number; w: number; h: number }) => {
        // the letters as the page is now: a moved or retyped line is where it was put, not where the file has it
        const chars = liveChars(await pdfHost.chars!(file, current), latest.current.items, current, size, measurer)
        const got = pickFrom(chars, area, size.width / size.height)
        if (!got.quads.length) setNote('There is no text under that box to mark. Scanned pages have no text.')
        return got
      }
    : undefined

  const marks = items.filter((i) => !isField(i) && !isContent(i)).length
  const changes = here.filter((i) => (i.kind === 'textline' ? lineChanged(i) : i.kind === 'picture' ? i.deleted || i.replace || i.box !== i.from : i.kind === 'erase')).length
  // the page is drawn without what was changed in it (a line moved or retyped, a picture moved, an erased area), so
  // what is seen is what the saved file will have; the changed things themselves are drawn by the editor
  const hide = (() => {
    const text: Rect[] = []
    const pictures: Rect[] = []
    const erase: Rect[] = []
    for (const i of items) {
      if (i.page !== current) continue
      if (i.kind === 'textline' && (lineChanged(i) || i.id === editing || i.id === dragging)) text.push(i.from)
      else if (i.kind === 'picture' && (pictureChanged(i) || i.id === dragging)) pictures.push(i.from)
      else if (i.kind === 'erase') erase.push(i.box)
    }
    return text.length || pictures.length || erase.length ? { text, pictures, erase } : undefined
  })()
  const addedFonts = [...new Set(o.fonts.map((f) => f.for ?? f.family))]

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div className="min-w-0 space-y-3 rounded-xl border border-line bg-surface p-4">
        <div role="group" aria-label="Mode" className="inline-flex rounded-lg border border-line p-0.5 text-sm">
          {MODES.filter(([m]) => m !== 'content' || pdfHost.content).map(([m, label]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)} className="rounded-md px-3 py-1 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent aria-pressed:bg-accent aria-pressed:text-on-accent pointer-coarse:min-h-11">
              {label}
            </button>
          ))}
        </div>
        <div role="toolbar" aria-label="Tools" className="flex flex-wrap items-center gap-0.5 rounded-lg border border-line p-1">
          {(mode === 'add' ? TOOLS : mode === 'content' ? CONTENT_TOOLS : FIELD_TOOLS).map((t) => (
            <button key={t.tool} type="button" title={t.key ? `${t.label} (${t.key.toUpperCase()})` : t.label} aria-label={t.label} aria-pressed={!ordering && tool === t.tool && t.tool !== 'image'} onClick={() => choose(t.tool)} className={iconButton}>
              <Icon name={t.icon} className="size-4" />
            </button>
          ))}
          {mode === 'forms' && (
            <>
              <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
              <button type="button" title="Set the Tab order: click the fields in turn" aria-label="Set the Tab order" aria-pressed={!!ordering} disabled={!pageFields.length} onClick={() => (ordering ? finishOrder() : (setOrdering([]), setTool('select'), setSelected(null)))} className={iconButton}>
                <Icon name="tab-order" className="size-4" />
              </button>
            </>
          )}
          <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
          <button type="button" title="Undo (Ctrl or Cmd+Z)" aria-label="Undo" onClick={undo} disabled={!past.current.length} className={iconButton}>
            <Icon name="undo" className="size-4" />
          </button>
          <button type="button" title="Redo (Shift+Ctrl or Cmd+Z)" aria-label="Redo" onClick={redo} disabled={!future.current.length} className={iconButton}>
            <Icon name="redo" className="size-4" />
          </button>
          <input ref={replacer} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f || sel?.kind !== 'picture') return
            try {
              const { data, type } = await pictureOf(f)
              update({ ...sel, replace: { data, type } })
            } catch {
              setNote(`${f.name} can't be read as a picture. PNG, JPEG, WebP and GIF pictures work.`)
            }
          }} />
          <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) await addPicture(f)
          }} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => go(-1)} disabled={current === 0} aria-label="Previous page" className={button}>
            Previous
          </button>
          <span role="status" className="text-sm tabular-nums">
            Page {current + 1} of {pages.length}
          </span>
          <button type="button" onClick={() => go(1)} disabled={current >= pages.length - 1} aria-label="Next page" className={button}>
            Next
          </button>
          <span className="ml-auto">{zoom.bar}</span>
        </div>
        <div ref={zoom.scroller} className="max-h-[75vh] overflow-auto">
          <div ref={pageBox} className="relative mx-auto bg-white shadow-sm ring-1 ring-line" style={{ aspectRatio: `${size.width} / ${size.height}`, width: zoom.width || '100%' }}>
            <Overlay
              page={current}
              size={size}
              width={zoom.width || 600}
              items={items}
              tool={tool}
              style={style}
              fonts={o.fonts}
              selected={selected}
              editing={editing}
              onSelect={setSelected}
              onEditing={setEditing}
              onChange={(next, select) => {
                commit(next, select)
                // after placing a shape or a box the pointer goes back to selecting, so it can be moved at once
                if (!KEEP.includes(tool)) setTool('select')
              }}
              pickText={pickText}
              newId={newId}
              content={mode !== 'forms' && pageContent ? pageContent : undefined}
              fieldsActive={mode === 'forms'}
              onDragging={setDragging}
              onPickContent={pick}
              order={ordering ? { numbers: new Map((ordering.length ? ordering : orderNow).map((id, k) => [id, k + 1])), pick: (id) => {
                const next = ordering.includes(id) ? ordering : [...ordering, id]
                if (next.length >= pageFields.length) {
                  setOrder(next)
                  setOrdering(null)
                } else setOrdering(next)
              } } : undefined}
            >
              <PdfPage key={current} file={file} page={current} renderWidth={zoom.renderWidth} fields={!o.fieldsLoaded.length} hide={hide} />
            </Overlay>
          </div>
        </div>
        {note && <p role="status" className="text-sm text-warning">{note}</p>}
        {found && <p role="status" className="text-sm text-muted">{found}</p>}
        {formNote && <p className="text-sm text-warning">{formNote}</p>}
        {ordering ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span role="status">{ordering.length ? `${ordering.length} of ${pageFields.length} picked. Click the next field.` : 'Click the fields in the order Tab should go through them.'}</span>
            <button type="button" className={button} onClick={() => (setOrder(byPosition(pageFields).map((f) => f.id)), setOrdering(null))}>By position</button>
            <button type="button" className={button} onClick={finishOrder}>Done</button>
          </div>
        ) : (
          <p className="text-xs text-muted">
            {mode === 'add'
              ? 'Pick a tool, then click or drag on the page. Double-click text to change it. Alt turns snapping off while you move something.'
              : mode === 'content'
                ? content.get(current) === 'failed'
                  ? "This page's content can't be read for editing."
                  : 'Click a line of text or a picture of the page to select it; double-click a line to change it. Text inside drawings the PDF groups (forms) and turned text can only be erased.'
                : "Pick a kind of field, then drag a box on the page. The file's own fields can be moved, set up or deleted too."}
          </p>
        )}
      </div>

      <div className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-4">
        <Properties
          item={sel}
          tool={tool}
          style={style}
          onStyle={setStyle}
          onItem={update}
          onRemove={() => sel && remove(sel.id)}
          onDuplicate={() => sel && duplicate(sel)}
          onOrder={(by) => sel && reorder(sel.id, by)}
          onEdit={() => (sel?.kind === 'text' || sel?.kind === 'textline') && setEditing(sel.id)}
          onReplace={() => replacer.current?.click()}
          groups={[...new Set(fields.filter((f) => f.type === 'radio').map((f) => f.name))]}
          onGroup={(target) => sel && commit(joinGroup(items, sel.id, target))}
          added={o.fonts}
          group={sel && isField(sel) ? fields.filter((f) => f.name === sel.name) : []}
          taken={new Set(sel && isField(sel) ? fields.filter((f) => f.name !== sel.name).map((f) => f.name.trim()) : [])}
          onField={(patch) => sel && isField(sel) && updateField(sel, patch)}
          pageCount={pages.length}
          fonts={addedFonts}
          onAddFont={
            readFontFile
              ? async (f) => {
                  const info = await readFontFile(f).catch(() => null)
                  const faces = (info?.faces ?? []).filter((x) => x.embeddable)
                  if (!info || !faces.length) {
                    setNote(`${f.name} can't be used: it isn't a font file, or its licence doesn't allow embedding it.`)
                    return null
                  }
                  const family = faces[0].typographic ?? faces[0].family
                  onChange({ ...latest.current, fonts: [...latest.current.fonts, ...faces.map((x) => ({ family: x.family, style: x.style, postscript: x.postscript, bytes: info.bytes, for: family, source: 'file' as const }))] })
                  return family
                }
              : undefined
          }
        />
        {mode !== 'forms' && pdfHost.fonts && (
          // the PDF's own fonts, found on the computer, added as files or downloaded: a changed line that its embedded
          // subset can't show keeps its family, and new text can be written in it
          <FontsPanel file={file} readOfficeFonts={pdfHost.fonts} readFontFile={readFontFile} value={o.fonts} onChange={(fonts) => onChange({ ...latest.current, fonts })} />
        )}
        {mode === 'forms' && !sel && pdfHost.layout && (
          <section aria-label="Find fields" className="space-y-2">
            <h3 className="text-sm font-medium">Find fields</h3>
            <p className="text-xs text-muted">Adds fields where the page has underscores, dotted lines, lines to write on, empty boxes and squares to tick, named after the words beside them. Check what it adds.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={button} disabled={finding} onClick={() => find([current])}>On this page</button>
              {pages.length > 1 && <button type="button" className={button} disabled={finding} onClick={() => find(pages.map((_, i) => i))}>On every page</button>}
            </div>
          </section>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={o.flattenComments} onChange={(e) => onChange({ ...o, flattenComments: e.target.checked })} className="mt-0.5" />
          <span>
            Flatten comments into the pages<span className="block text-xs text-muted">Highlights and notes become part of the page, so they can't be changed or removed. Links stay links.</span>
          </span>
        </label>
        <p className="text-sm text-muted" role="status">
          {mode === 'content'
            ? `${changes} ${changes === 1 ? 'change' : 'changes'} to this page's own content.`
            : mode === 'forms'
            ? `${pageFields.length} ${pageFields.length === 1 ? 'field' : 'fields'} on this page, ${new Set(fields.map((f) => f.name)).size} in all.`
            : marks === 0 ? 'Nothing added yet.' : `${here.filter((i) => !isField(i) && !isContent(i)).length} ${here.filter((i) => !isField(i) && !isContent(i)).length === 1 ? 'thing' : 'things'} on this page, ${marks} in all.`}
        </p>
        {actions}
      </div>
    </div>
  )
}

/** a picture file as PNG or JPEG bytes the PDF can hold, with its size */
async function pictureOf(f: File): Promise<{ data: Uint8Array; type: 'image/png' | 'image/jpeg'; width: number; height: number }> {
  const bitmap = await createImageBitmap(f)
  const { width, height } = bitmap
  if (f.type === 'image/jpeg' || f.type === 'image/png') {
    bitmap.close()
    // ponytail: a JPEG goes in as it is, so a camera photo turned by its EXIF orientation shows unturned; draw it through a canvas if that comes up
    return { data: new Uint8Array(await f.arrayBuffer()), type: f.type, width, height }
  }
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return { data: new Uint8Array(await blob.arrayBuffer()), type: 'image/png', width, height }
}

/** what part of the drawn page looks like, as a PNG data URL, to show a picture of the page's while it is moved */
function cropOf(page: HTMLElement | null, box: { x: number; y: number; w: number; h: number }): string {
  const c = page?.querySelector('canvas')
  if (!c || !c.width) return ''
  const [sx, sy, sw, sh] = [box.x * c.width, box.y * c.height, Math.max(1, box.w * c.width), Math.max(1, box.h * c.height)]
  const out = document.createElement('canvas')
  out.width = Math.round(sw)
  out.height = Math.round(sh)
  out.getContext('2d')!.drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}

/** a message in place of the panel, with the run button still there */
function Waiting({ children, actions }: { children: string; actions: PanelProps['actions'] }) {
  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{children}</p>
      {actions}
    </div>
  )
}
