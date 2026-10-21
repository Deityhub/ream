import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Rect } from '../rect.ts'
import { boxOf, moved, resized, snap, type Handle } from './geometry.ts'
import { wrapLines } from './layout.ts'
import { cssFamily, loadFont, measurer } from './viewFonts.ts'
import type { InstalledFont } from '../fonts/book.ts'
import { FIELD_SIZE, newField } from './fields.ts'
import { fallbackFont, lineChanged, type PageContent } from './content.ts'
import { isField, itemsOn, type FieldItem, type FieldType, type Item, type LineEditItem, type PictureEditItem, type Point, type TextItem } from './items.ts'

export type FieldTool = `field-${FieldType}`
export type Tool = 'select' | 'erase' | 'text' | 'image' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'pen' | 'highlighter' | 'whiteout' | 'highlight' | 'underline' | 'strike' | 'note' | 'link' | FieldTool
const fieldType = (t: Tool): FieldType | null => (t.startsWith('field-') ? (t.slice(6) as FieldType) : null)

/** what a new item of each kind starts with (the properties panel changes these when nothing is selected) */
export type Style = {
  text: Pick<TextItem, 'font' | 'size' | 'colour' | 'bold' | 'italic' | 'align' | 'spacing' | 'opacity'>
  shape: { fill: string | null; stroke: string | null; width: number; opacity: number }
  line: { colour: string; width: number; opacity: number }
  pen: { colour: string; width: number }
  highlighter: { colour: string; width: number }
  whiteout: { colour: string }
  markup: { highlight: string; underline: string; strike: string }
  note: { colour: string }
}

type Props = {
  page: number
  /** points, as displayed */
  size: { width: number; height: number }
  /** CSS pixels the page is shown across */
  width: number
  items: Item[]
  tool: Tool
  style: Style
  fonts: InstalledFont[]
  selected: string | null
  editing: string | null
  onSelect: (id: string | null) => void
  onEditing: (id: string | null) => void
  /** a new list of items (one undo step) */
  onChange: (items: Item[], select?: string | null) => void
  /** the page's text under a box, for markup (null when it can't be read) */
  pickText?: (area: Rect) => Promise<{ quads: [Point, Point, Point, Point][]; text: string } | null>
  newId: () => string
  /** the Tab order being set: each field's number, and a click on a field picks it next */
  order?: { numbers: Map<string, number>; pick: (id: string) => void }
  /** the page's own lines and pictures, to pick for changing (content mode) */
  content?: PageContent
  onPickContent?: (kind: 'line' | 'picture', id: number, edit: boolean) => void
  /** form fields can be picked (forms mode); otherwise they are shown faintly and let clicks through to the page */
  fieldsActive?: boolean
  /** the picture of the page, drawn under everything */
  children: ReactNode
}

type Drag =
  | { mode: 'move'; id: string; from: Point; original: Item }
  | { mode: 'resize'; id: string; handle: Handle; original: Item }
  | { mode: 'end'; id: string; which: 'from' | 'to'; original: Item }
  | { mode: 'create'; tool: Tool; from: Point; to: Point }
  | { mode: 'draw'; tool: 'pen' | 'highlighter'; points: Point[] }

const SNAP_PX = 6
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function Overlay({ page, size, width, items, tool, style, fonts, selected, editing, onSelect, onEditing, onChange, pickText, newId, order, content, onPickContent, fieldsActive = true, children }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [draft, setDraft] = useState<Item | null>(null)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [, setFontsLoaded] = useState(0)
  const scale = width / size.width // CSS pixels per point
  const height = size.height * scale
  const shown = itemsOn(items, page).map((i) => (draft && i.id === draft.id ? draft : i))

  // the fonts of the text on this page, so it shows (and breaks lines) as in the saved file
  const wanted = [
    ...shown.filter((i): i is TextItem => i.kind === 'text').map((t) => `${t.font}/${t.bold}/${t.italic}`),
    ...shown.filter((i): i is LineEditItem => i.kind === 'textline').map((t) => `${shownFont(t)}/${t.bold}/${t.italic}`),
  ]
  useEffect(() => {
    let live = true
    Promise.all([...new Set(wanted)].map((k) => {
      const [font, bold, italic] = k.split('/')
      return loadFont(font, bold === 'true', italic === 'true', fonts)
    })).then(() => live && setFontsLoaded((n) => n + 1))
    return () => {
      live = false
    }
  }, [wanted.join('|'), fonts]) // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e: { clientX: number; clientY: number }): Point => {
    const r = root.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }
  const replace = (next: Item) => items.map((i) => (i.id === next.id ? next : i))

  // ---------- starting a gesture ----------
  const onRootDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || editing) return
    const p = at(e)
    if (tool === 'select') {
      onSelect(null)
      return
    }
    root.current!.setPointerCapture(e.pointerId)
    if (tool === 'pen' || tool === 'highlighter') setDrag({ mode: 'draw', tool, points: [p] })
    else if (tool === 'note') {
      const id = newId()
      onChange([...items, { id, page, kind: 'note', at: p, text: '', colour: style.note.colour }], id)
    } else if (tool !== 'image') setDrag({ mode: 'create', tool, from: p, to: p })
  }
  const onItemDown = (e: ReactPointerEvent, item: Item) => {
    if (order && isField(item) && e.button === 0) {
      e.stopPropagation()
      return order.pick(item.id)
    }
    if (tool !== 'select' || e.button !== 0 || editing === item.id) return
    e.stopPropagation()
    onSelect(item.id)
    root.current!.setPointerCapture(e.pointerId)
    setDrag({ mode: 'move', id: item.id, from: at(e), original: item })
  }
  const onHandleDown = (e: ReactPointerEvent, item: Item, handle: Handle | 'from' | 'to') => {
    e.stopPropagation()
    root.current!.setPointerCapture(e.pointerId)
    if (handle === 'from' || handle === 'to') setDrag({ mode: 'end', id: item.id, which: handle, original: item })
    else setDrag({ mode: 'resize', id: item.id, handle, original: item })
  }

  // ---------- following it ----------
  const others = (id: string) => shown.filter((i) => i.id !== id).map(boxOf)
  const tol = { x: SNAP_PX / width, y: SNAP_PX / height }
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return
    const p = at(e)
    if (drag.mode === 'draw') return setDrag({ ...drag, points: [...drag.points, p] })
    if (drag.mode === 'create') return setDrag({ ...drag, to: p })
    if (drag.mode === 'move') {
      let dx = p.x - drag.from.x
      let dy = p.y - drag.from.y
      const box = boxOf(drag.original)
      // snapping is off while Alt is held
      const s = e.altKey ? null : snap({ ...box, x: box.x + dx, y: box.y + dy }, others(drag.id), tol)
      if (s) {
        dx += s.dx
        dy += s.dy
      }
      setGuides(s?.guides ?? { x: [], y: [] })
      return setDraft(moved(drag.original, dx, dy))
    }
    if (drag.mode === 'resize' && 'box' in drag.original) {
      const keep = (drag.original.kind === 'image' || drag.original.kind === 'picture') && !e.shiftKey
      return setDraft({ ...drag.original, box: resized(drag.original.box, drag.handle, p, keep) } as Item)
    }
    if (drag.mode === 'end' && drag.original.kind === 'line') return setDraft({ ...drag.original, [drag.which]: p })
  }

  // ---------- ending it ----------
  const onUp = async () => {
    const d = drag
    setDrag(null)
    setGuides({ x: [], y: [] })
    if (!d) return
    if (d.mode === 'move' || d.mode === 'resize' || d.mode === 'end') {
      if (draft) onChange(replace(draft))
      setDraft(null)
      return
    }
    if (d.mode === 'draw') {
      if (d.points.length < 1) return
      const s = d.tool === 'pen' ? style.pen : style.highlighter
      onChange([...items, { id: newId(), page, kind: 'draw', strokes: [thin(d.points, 0.6 / width)], colour: s.colour, width: s.width, highlighter: d.tool === 'highlighter' }])
      return
    }
    // a drag makes the box; a click makes one of a usual size where it was
    const tiny = Math.abs(d.to.x - d.from.x) * width < 4 && Math.abs(d.to.y - d.from.y) * height < 4
    const box = tiny ? defaultBox(d.tool, d.from, size) : { x: Math.min(d.from.x, d.to.x), y: Math.min(d.from.y, d.to.y), w: Math.abs(d.to.x - d.from.x), h: Math.abs(d.to.y - d.from.y) }
    const id = newId()
    const base = { id, page }
    const type = fieldType(d.tool)
    if (type) {
      const [w, h] = FIELD_SIZE[type]
      const b = tiny ? { x: Math.min(d.from.x, 1 - w / size.width), y: Math.min(d.from.y, 1 - h / size.height), w: w / size.width, h: h / size.height } : box
      const join = items.find((i): i is FieldItem => i.id === selected && isField(i)) ?? null
      onChange([...items, newField(id, page, type, b, items.filter(isField), join)], id)
    } else if (d.tool === 'text') {
      onChange([...items, { ...base, kind: 'text', box, text: '', ...style.text }], id)
      onEditing(id)
    } else if (d.tool === 'rect' || d.tool === 'ellipse') onChange([...items, { ...base, kind: 'shape', shape: d.tool, box, ...style.shape }], id)
    else if (d.tool === 'whiteout') onChange([...items, { ...base, kind: 'whiteout', box, colour: style.whiteout.colour }], id)
    else if (d.tool === 'erase' && !tiny) onChange([...items, { ...base, kind: 'erase', box }], id)
    else if (d.tool === 'link') onChange([...items, { ...base, kind: 'link', box, url: '', target: null }], id)
    else if (d.tool === 'line' || d.tool === 'arrow') {
      const to = tiny ? { x: clamp01(d.from.x + 0.2), y: d.from.y } : d.to
      onChange([...items, { ...base, kind: 'line', from: d.from, to, ...style.line, arrow: d.tool === 'arrow' ? 'end' : 'none' }], id)
    } else if ((d.tool === 'highlight' || d.tool === 'underline' || d.tool === 'strike') && pickText && !tiny) {
      const got = await pickText(box)
      if (got && got.quads.length) onChange([...items, { ...base, kind: 'markup', type: d.tool, quads: got.quads, text: got.text, colour: style.markup[d.tool] }], id)
    }
  }

  // ---------- drawing ----------
  const P = (v: number, axis: 'x' | 'y') => v * (axis === 'x' ? size.width : size.height)
  const creating = drag?.mode === 'create' ? { x: Math.min(drag.from.x, drag.to.x), y: Math.min(drag.from.y, drag.to.y), w: Math.abs(drag.to.x - drag.from.x), h: Math.abs(drag.to.y - drag.from.y) } : null
  const sel = shown.find((i) => i.id === selected) ?? null
  const urls = usePictureUrls(shown)
  const hit = tool === 'select' || order ? 'auto' : 'none'

  return (
    <div
      ref={root}
      onPointerDown={onRootDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      // the first click of a double-click on a line of the page makes its item, so the second lands elsewhere: the
      // double-click is caught here and opens the line now selected
      onDoubleClick={() => tool === 'select' && sel?.kind === 'textline' && !sel.deleted && onEditing(sel.id)}
      className={`relative size-full touch-none select-none ${tool === 'select' ? '' : 'cursor-crosshair'}`}
    >
      {children}
      <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
        {shown.map((i) => (
          <g key={i.id} style={{ pointerEvents: hit }} onPointerDown={(e) => onItemDown(e, i)}>
            <Shape item={i} P={P} />
          </g>
        ))}
        {drag?.mode === 'draw' && <polyline points={drag.points.map((p) => `${P(p.x, 'x')},${P(p.y, 'y')}`).join(' ')} fill="none" stroke={drag.tool === 'pen' ? style.pen.colour : style.highlighter.colour} strokeOpacity={drag.tool === 'pen' ? 1 : 0.5} strokeWidth={drag.tool === 'pen' ? style.pen.width : style.highlighter.width} strokeLinecap="round" strokeLinejoin="round" />}
        {creating && <rect x={P(creating.x, 'x')} y={P(creating.y, 'y')} width={P(creating.w, 'x')} height={P(creating.h, 'y')} fill="none" stroke="currentColor" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" className="text-accent" />}
        {drag?.mode === 'create' && (drag.tool === 'line' || drag.tool === 'arrow') && <line x1={P(drag.from.x, 'x')} y1={P(drag.from.y, 'y')} x2={P(drag.to.x, 'x')} y2={P(drag.to.y, 'y')} stroke={style.line.colour} strokeWidth={style.line.width} />}
        {guides.x.map((g) => <line key={`gx${g}`} x1={P(g, 'x')} x2={P(g, 'x')} y1={0} y2={size.height} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" className="text-accent" />)}
        {guides.y.map((g) => <line key={`gy${g}`} y1={P(g, 'y')} y2={P(g, 'y')} x1={0} x2={size.width} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" className="text-accent" />)}
      </svg>

      {[...shown.filter((i) => !isField(i)), ...shown.filter(isField)].map((i) => {
        if (i.kind === 'text') {
          if (i.id === editing) return <TextEditor key={i.id} item={i} scale={scale} onDone={(text) => {
            onEditing(null)
            onChange(text.trim() ? replace({ ...i, text }) : items.filter((x) => x.id !== i.id), text.trim() ? i.id : null)
          }} />
          return <TextView key={i.id} item={i} scale={scale} size={size} hit={hit} onPointerDown={(e) => onItemDown(e, i)} onDoubleClick={() => tool === 'select' && onEditing(i.id)} />
        }
        if (i.kind === 'image') {
          const { x, y, w, h } = i.box
          const turned = i.turns % 2 === 1
          return (
            <div key={i.id} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, pointerEvents: hit, opacity: i.opacity }} className="absolute flex items-center justify-center overflow-visible" onPointerDown={(e) => onItemDown(e, i)}>
              <img src={urls.get(i.data)} alt="" draggable={false} className="max-w-none" style={{ width: turned ? `${(h * size.height) / (w * size.width) * 100}%` : '100%', height: turned ? `${(w * size.width) / (h * size.height) * 100}%` : '100%', transform: `rotate(${i.turns * 90}deg)` }} />
            </div>
          )
        }
        if (i.kind === 'textline') {
          if (i.id === editing) return <LineEditor key={i.id} item={i} scale={scale} onDone={(text) => {
            onEditing(null)
            if (text !== i.text) onChange(replace({ ...i, text }), i.id)
          }} />
          return <LineView key={i.id} item={i} scale={scale} hit={hit} onPointerDown={(e) => onItemDown(e, i)} />
        }
        if (i.kind === 'picture') return <PictureView key={i.id} item={i} url={i.replace ? urls.get(i.replace.data) : i.preview} hit={hit} onPointerDown={(e) => onItemDown(e, i)} />
        if (i.kind === 'erase') return <div key={i.id} style={{ left: `${i.box.x * 100}%`, top: `${i.box.y * 100}%`, width: `${i.box.w * 100}%`, height: `${i.box.h * 100}%`, pointerEvents: hit }} onPointerDown={(e) => onItemDown(e, i)} className="absolute border border-dashed border-[rgb(220_38_38)] bg-white" title="Erased" />
        if (i.kind === 'field') return <FieldView key={i.id} item={i} scale={scale} pageHeight={height} hit={fieldsActive ? hit : 'none'} faint={!fieldsActive} number={order?.numbers.get(i.id)} onPointerDown={(e) => onItemDown(e, i)} />
        if (i.kind === 'note') {
          return (
            <div key={i.id} title={i.text || 'Note'} style={{ left: `${i.at.x * 100}%`, top: `${i.at.y * 100}%`, width: 20 * scale, height: 20 * scale, background: i.colour, pointerEvents: hit }} className="absolute rounded-sm border border-black/60 shadow-sm" onPointerDown={(e) => onItemDown(e, i)} />
          )
        }
        return null
      })}

      {content && tool === 'select' && !order && (
        <>
          {content.lines.filter((l) => !shown.some((i) => i.kind === 'textline' && i.source === l.id)).map((l) => (
            <div key={`l${l.id}`} title="Click to select, double-click to change" onPointerDown={(e) => (e.stopPropagation(), e.button === 0 && onPickContent?.('line', l.id, false))} style={{ left: `${l.box.x * 100}%`, top: `${l.box.y * 100}%`, width: `${l.box.w * 100}%`, height: `${l.box.h * 100}%` }} className="absolute cursor-text rounded-sm outline-1 outline-transparent hover:bg-[rgb(37_99_235/0.08)] hover:outline-[rgb(37_99_235)]" />
          ))}
          {content.pictures.filter((p) => !shown.some((i) => i.kind === 'picture' && i.source === p.id)).map((p) => (
            <div key={`p${p.id}`} title="Click to select the picture" onPointerDown={(e) => (e.stopPropagation(), e.button === 0 && onPickContent?.('picture', p.id, false))} style={{ left: `${p.box.x * 100}%`, top: `${p.box.y * 100}%`, width: `${p.box.w * 100}%`, height: `${p.box.h * 100}%` }} className="absolute outline-1 outline-transparent hover:outline-dashed hover:outline-[rgb(37_99_235)]" />
          ))}
        </>
      )}
      {sel && tool === 'select' && !editing && !order && <Selection item={sel} scale={scale} size={size} onHandleDown={(e, h) => onHandleDown(e, sel, h)} />}
    </div>
  )
}

/** a box of the usual size for a click, kept on the page */
function defaultBox(tool: Tool, p: Point, size: { width: number; height: number }): Rect {
  const [w, h] = tool === 'text' ? [180, 20] : tool === 'link' ? [120, 20] : tool === 'whiteout' ? [120, 24] : [100, 60]
  const fw = Math.min(1, w / size.width)
  const fh = Math.min(1, h / size.height)
  return { x: Math.min(p.x, 1 - fw), y: Math.min(p.y, 1 - fh), w: fw, h: fh }
}

/** a stroke without the points closer than `min` to the one before (the pointer reports many) */
function thin(points: Point[], min: number): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= min) out.push(p)
  }
  return out
}

/** object URLs for the pictures shown, made once per picture and let go when it leaves */
function usePictureUrls(items: Item[]): Map<Uint8Array, string> {
  const cache = useRef(new Map<Uint8Array, string>())
  const pictures = items.flatMap((i) => (i.kind === 'image' ? [{ id: i.id, data: i.data, type: i.type }] : i.kind === 'picture' && i.replace ? [{ id: i.id, ...i.replace }] : []))
  const urls = useMemo(() => {
    const next = new Map<Uint8Array, string>()
    for (const p of pictures) next.set(p.data, cache.current.get(p.data) ?? URL.createObjectURL(new Blob([p.data as BlobPart], { type: p.type })))
    for (const [data, url] of cache.current) if (!next.has(data)) URL.revokeObjectURL(url)
    cache.current = next
    return next
  }, [pictures.map((p) => p.id).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cache.current.forEach((u) => URL.revokeObjectURL(u)), [])
  return urls
}

/** shapes, lines, drawings, whiteout, markup and link boxes, in page points */
function Shape({ item: i, P }: { item: Item; P: (v: number, axis: 'x' | 'y') => number }) {
  const box = (r: Rect) => ({ x: P(r.x, 'x'), y: P(r.y, 'y'), w: P(r.w, 'x'), h: P(r.h, 'y') })
  if (i.kind === 'whiteout') {
    const b = box(i.box)
    return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={i.colour} />
  }
  if (i.kind === 'shape') {
    const b = box(i.box)
    const inset = i.stroke ? i.width / 2 : 0
    const common = { fill: i.fill ?? 'transparent', stroke: i.stroke ?? 'none', strokeWidth: i.width, opacity: i.opacity }
    if (i.shape === 'rect') return <rect x={b.x + inset} y={b.y + inset} width={Math.max(0, b.w - 2 * inset)} height={Math.max(0, b.h - 2 * inset)} {...common} />
    return <ellipse cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={Math.max(0, b.w / 2 - inset)} ry={Math.max(0, b.h / 2 - inset)} {...common} />
  }
  if (i.kind === 'line') {
    const [x1, y1, x2, y2] = [P(i.from.x, 'x'), P(i.from.y, 'y'), P(i.to.x, 'x'), P(i.to.y, 'y')]
    const head = Math.max(6, i.width * 3.5)
    const tri = (tx: number, ty: number, fx: number, fy: number) => {
      const a = Math.atan2(ty - fy, tx - fx)
      return [[tx, ty], [tx - head * Math.cos(a + 0.45), ty - head * Math.sin(a + 0.45)], [tx - head * Math.cos(a - 0.45), ty - head * Math.sin(a - 0.45)]].map((p) => p.join(',')).join(' ')
    }
    return (
      <g opacity={i.opacity}>
        {/* a wide invisible line makes a thin one easy to pick */}
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(12, i.width + 8)} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={i.colour} strokeWidth={i.width} />
        {i.arrow !== 'none' && <polygon points={tri(x2, y2, x1, y1)} fill={i.colour} />}
        {i.arrow === 'both' && <polygon points={tri(x1, y1, x2, y2)} fill={i.colour} />}
      </g>
    )
  }
  if (i.kind === 'draw') {
    return (
      <g style={i.highlighter ? { mixBlendMode: 'multiply' } : undefined}>
        {i.strokes.map((s, k) => (
          <polyline key={k} points={s.map((p) => `${P(p.x, 'x')},${P(p.y, 'y')}`).join(' ')} fill="none" stroke={i.colour} strokeOpacity={i.highlighter ? 0.5 : 1} strokeWidth={i.width} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </g>
    )
  }
  if (i.kind === 'markup') {
    return (
      <g>
        {i.quads.map(([ul, ur, ll, lr], k) => {
          if (i.type === 'highlight') return <polygon key={k} points={[ul, ur, lr, ll].map((p) => `${P(p.x, 'x')},${P(p.y, 'y')}`).join(' ')} fill={i.colour} style={{ mixBlendMode: 'multiply' }} />
          const t = i.type === 'underline' ? 0.92 : 0.55
          const a = { x: ul.x + (ll.x - ul.x) * t, y: ul.y + (ll.y - ul.y) * t }
          const b = { x: ur.x + (lr.x - ur.x) * t, y: ur.y + (lr.y - ur.y) * t }
          const h = P(ll.y - ul.y, 'y')
          return <line key={k} x1={P(a.x, 'x')} y1={P(a.y, 'y')} x2={P(b.x, 'x')} y2={P(b.y, 'y')} stroke={i.colour} strokeWidth={Math.max(0.5, h / 14)} />
        })}
      </g>
    )
  }
  if (i.kind === 'link') {
    const b = box(i.box)
    // shown only in the editor: the saved link has no border
    return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="rgb(37 99 235 / 0.08)" stroke="rgb(37 99 235)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
  }
  return null
}

/** the lines a text item shows, as the saved file breaks them (the box's width is a fraction of the page's) */
function linesOf(item: TextItem, scale: number, pageWidth: number) {
  const px = item.size * scale
  return { px, lines: wrapLines(item.text, item.box.w * pageWidth * scale, measurer(item.font, item.bold, item.italic, px)) }
}

function textStyle(item: TextItem, px: number) {
  return {
    fontFamily: `${cssFamily(item.font)}, sans-serif`,
    fontSize: px,
    fontWeight: item.bold ? 700 : 400,
    fontStyle: item.italic ? 'italic' : 'normal',
    lineHeight: `${px * item.spacing}px`,
    color: item.colour,
    textAlign: item.align,
    fontKerning: 'none' as const,
  }
}

function TextView({ item, scale, size, hit, onPointerDown, onDoubleClick }: { item: TextItem; scale: number; size: { width: number; height: number }; hit: 'auto' | 'none'; onPointerDown: (e: ReactPointerEvent) => void; onDoubleClick: () => void }) {
  const { px, lines } = linesOf(item, scale, size.width)
  return (
    <div onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} style={{ left: `${item.box.x * 100}%`, top: `${item.box.y * 100}%`, width: `${item.box.w * 100}%`, pointerEvents: hit, opacity: item.opacity, ...textStyle(item, px) }} className="absolute whitespace-pre">
      {lines.map((l, k) => (
        <div key={k}>{l || '​'}</div>
      ))}
    </div>
  )
}

function TextEditor({ item, scale, onDone }: { item: TextItem; scale: number; onDone: (text: string) => void }) {
  const [text, setText] = useState(item.text)
  const ref = useRef<HTMLTextAreaElement>(null)
  const px = item.size * scale
  useEffect(() => {
    ref.current?.focus()
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [text])
  return (
    <textarea
      ref={ref}
      value={text}
      aria-label="Text"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') ref.current?.blur()
        e.stopPropagation()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left: `${item.box.x * 100}%`, top: `${item.box.y * 100}%`, width: `${item.box.w * 100}%`, ...textStyle(item, px) }}
      className="absolute m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline-2 outline-offset-2 outline-accent [overflow-wrap:anywhere]"
    />
  )
}

const FIELD_LABEL: Record<FieldType, string> = { text: 'Text', date: 'Date', checkbox: '', radio: '', dropdown: '▾', list: 'List', signature: 'Signature' }

/** a form field in the editor: a tinted box with what it holds (the saved field looks as its settings say) */
function FieldView({ item: i, scale, pageHeight, hit, faint, number, onPointerDown }: { item: FieldItem; scale: number; pageHeight: number; faint?: boolean; hit: 'auto' | 'none'; number?: number; onPointerDown: (e: ReactPointerEvent) => void }) {
  const round = i.type === 'radio'
  const on = i.type === 'checkbox' ? i.value === true : i.type === 'radio' && i.value === i.state
  const shown = i.type === 'checkbox' || i.type === 'radio' ? (on ? (round ? '●' : '✓') : '') : i.type === 'dropdown' ? `${i.options.find((o) => o.value === i.value)?.label ?? i.value} ▾` : String(i.value || FIELD_LABEL[i.type])
  const px = Math.max(6, i.fontSize ? i.fontSize * scale : Math.min(12 * scale, (i.type === 'list' || i.multiline ? 12 * scale : i.box.h * pageHeight * 0.7)))
  return (
    <div
      title={`${i.name}${i.locked ? ' (can only be moved or deleted)' : ''}`}
      onPointerDown={onPointerDown}
      style={{ left: `${i.box.x * 100}%`, top: `${i.box.y * 100}%`, width: `${i.box.w * 100}%`, height: `${i.box.h * 100}%`, pointerEvents: hit, fontSize: px, background: i.background ?? undefined, opacity: faint ? 0.45 : undefined }}
      className={`absolute flex items-center border border-dashed px-0.5 leading-none text-[rgb(30_64_175)] ${i.locked ? 'border-[rgb(180_83_9)] bg-[rgb(245_158_11/0.12)]' : 'border-[rgb(37_99_235)] bg-[rgb(37_99_235/0.1)]'} ${round ? 'justify-center rounded-full' : i.type === 'checkbox' ? 'justify-center' : i.type === 'list' || i.multiline ? 'items-start pt-0.5' : ''}`}
    >
      <span className={`max-w-full truncate ${i.value === '' || i.value === false ? 'opacity-60' : ''}`}>{shown}</span>
      {number !== undefined && <span className="absolute -left-2 -top-2 flex size-5 items-center justify-center rounded-full bg-[rgb(37_99_235)] text-[11px] font-medium text-white">{number}</span>}
    </div>
  )
}

/** the font a line of the page is shown in by the editor: its stand-in when it keeps its own (the browser can't use the PDF's) */
const shownFont = (i: LineEditItem) => fallbackFont(i)

/** CSS for a line of the page at its size: the line box is the em box (a quarter em below the baseline to an em above) */
function lineStyle(i: LineEditItem, scale: number) {
  const px = i.size * scale
  return { fontFamily: `${cssFamily(shownFont(i))}, sans-serif`, fontSize: px, lineHeight: `${px * 1.25}px`, fontWeight: i.bold ? 700 : 400, fontStyle: i.italic ? 'italic' : 'normal', color: i.colour, fontKerning: 'none' as const }
}

/** white over where something of the page's own was, so the editor shows it changed (the saved file really removes it) */
const Cover = ({ r, colour }: { r: Rect; colour?: string }) => <div aria-hidden="true" className="pointer-events-none absolute" style={{ background: colour ?? '#ffffff', left: `calc(${r.x * 100}% - 1px)`, top: `calc(${r.y * 100}% - 1px)`, width: `calc(${r.w * 100}% + 2px)`, height: `calc(${r.h * 100}% + 2px)` }} />

function LineView({ item: i, scale, hit, onPointerDown }: { item: LineEditItem; scale: number; hit: 'auto' | 'none'; onPointerDown: (e: ReactPointerEvent) => void }) {
  const changed = lineChanged(i)
  return (
    <>
      {changed && <Cover r={i.from} colour={i.cover} />}
      <div
        onPointerDown={onPointerDown}
        style={{ left: `${i.box.x * 100}%`, top: `${i.box.y * 100}%`, minWidth: `${i.box.w * 100}%`, height: `${i.box.h * 100}%`, pointerEvents: hit, ...(changed ? lineStyle(i, scale) : {}) }}
        className={`absolute whitespace-pre ${changed ? '' : 'text-transparent'} ${i.deleted ? 'opacity-0' : ''}`}
      >
        {changed && !i.deleted ? i.text : ''}
      </div>
    </>
  )
}

function LineEditor({ item, scale, onDone }: { item: LineEditItem; scale: number; onDone: (text: string) => void }) {
  const [text, setText] = useState(item.text)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <>
      <Cover r={item.from} colour={item.cover} />
      <input
        ref={ref}
        value={text}
        aria-label="Line of text"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onDone(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') ref.current?.blur()
          e.stopPropagation()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ left: `${item.box.x * 100}%`, top: `${item.box.y * 100}%`, width: `max(${item.box.w * 100}%, ${(text.length + 2) * 0.6}em)`, ...lineStyle(item, scale) }}
        className="absolute m-0 border-0 bg-transparent p-0 outline-2 outline-offset-2 outline-accent"
      />
    </>
  )
}

function PictureView({ item: i, url, hit, onPointerDown }: { item: PictureEditItem; url?: string; hit: 'auto' | 'none'; onPointerDown: (e: ReactPointerEvent) => void }) {
  const changed = !!i.deleted || !!i.replace || i.box.x !== i.from.x || i.box.y !== i.from.y || i.box.w !== i.from.w || i.box.h !== i.from.h
  return (
    <>
      {changed && <Cover r={i.from} colour={i.cover} />}
      <div onPointerDown={onPointerDown} style={{ left: `${i.box.x * 100}%`, top: `${i.box.y * 100}%`, width: `${i.box.w * 100}%`, height: `${i.box.h * 100}%`, pointerEvents: hit }} className="absolute">
        {changed && !i.deleted && url && <img src={url} alt="" draggable={false} className="size-full" />}
      </div>
    </>
  )
}

/** where each handle sits: just outside the box, so on a small item (a one-line form field) they don't hide what it shows */
const OUTSIDE: Partial<Record<Handle | 'from' | 'to', string>> = {
  nw: 'translate(-100%, -100%)', ne: 'translate(0, -100%)', sw: 'translate(-100%, 0)', se: 'translate(0, 0)',
  n: 'translate(-50%, -100%)', s: 'translate(-50%, 0)', e: 'translate(0, -50%)', w: 'translate(-100%, -50%)',
}

/** the outline of the selected item, with its handles */
function Selection({ item, scale, size, onHandleDown }: { item: Item; scale: number; size: { width: number; height: number }; onHandleDown: (e: ReactPointerEvent, h: Handle | 'from' | 'to') => void }) {
  const handle = (key: string, x: number, y: number, h: Handle | 'from' | 'to', label: string) => (
    <button
      key={key}
      type="button"
      aria-label={label}
      onPointerDown={(e) => onHandleDown(e, h)}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: OUTSIDE[h] ?? 'translate(-50%, -50%)' }}
      className="absolute size-3 rounded-sm border border-accent bg-surface pointer-coarse:size-6"
    />
  )
  if (item.kind === 'line') return <>{[handle('a', item.from.x, item.from.y, 'from', 'Move the start'), handle('b', item.to.x, item.to.y, 'to', 'Move the end')]}</>
  let b = boxOf(item)
  if (item.kind === 'text') {
    const lines = linesOf(item, scale, size.width).lines.length
    b = { ...b, h: (lines * item.size * item.spacing) / size.height }
  }
  if (item.kind === 'note') b = { ...b, w: 20 / size.width, h: 20 / size.height }
  const outline = <div key="o" className="pointer-events-none absolute outline-2 outline-dashed outline-accent" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />
  if (!('box' in item) || item.kind === 'textline') return outline
  const { x, y, w, h } = b
  const sides: [Handle, number, number, string][] = [
    ['nw', x, y, 'Resize from the top left'], ['ne', x + w, y, 'Resize from the top right'], ['sw', x, y + h, 'Resize from the bottom left'], ['se', x + w, y + h, 'Resize from the bottom right'],
    ['e', x + w, y + h / 2, 'Resize from the right'], ['w', x, y + h / 2, 'Resize from the left'],
  ]
  // text grows down with its lines: only its width is set by hand
  const shown = item.kind === 'text' ? sides.filter(([s]) => s === 'e' || s === 'w') : [...sides, ['n', x + w / 2, y, 'Resize from the top'] as [Handle, number, number, string], ['s', x + w / 2, y + h, 'Resize from the bottom'] as [Handle, number, number, string]]
  return (
    <>
      {outline}
      {shown.map(([s, hx, hy, label]) => handle(s, hx, hy, s, label))}
    </>
  )
}
