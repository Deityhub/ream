import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Rect } from '../rect.ts'
import { boxOf, moved, resized, snap, type Handle } from './geometry.ts'
import { wrapLines } from './layout.ts'
import { cssFamily, loadFont, measurer } from './viewFonts.ts'
import type { InstalledFont } from '../fonts/book.ts'
import { itemsOn, type Item, type Point, type TextItem } from './items.ts'

export type Tool = 'select' | 'text' | 'image' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'pen' | 'highlighter' | 'whiteout' | 'highlight' | 'underline' | 'strike' | 'note' | 'link'

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

export function Overlay({ page, size, width, items, tool, style, fonts, selected, editing, onSelect, onEditing, onChange, pickText, newId, children }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [draft, setDraft] = useState<Item | null>(null)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [, setFontsLoaded] = useState(0)
  const scale = width / size.width // CSS pixels per point
  const height = size.height * scale
  const shown = itemsOn(items, page).map((i) => (draft && i.id === draft.id ? draft : i))

  // the fonts of the text on this page, so it shows (and breaks lines) as in the saved file
  const wanted = shown.filter((i): i is TextItem => i.kind === 'text').map((t) => `${t.font}/${t.bold}/${t.italic}`)
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
      const keep = drag.original.kind === 'image' && !e.shiftKey
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
    if (d.tool === 'text') {
      onChange([...items, { ...base, kind: 'text', box, text: '', ...style.text }], id)
      onEditing(id)
    } else if (d.tool === 'rect' || d.tool === 'ellipse') onChange([...items, { ...base, kind: 'shape', shape: d.tool, box, ...style.shape }], id)
    else if (d.tool === 'whiteout') onChange([...items, { ...base, kind: 'whiteout', box, colour: style.whiteout.colour }], id)
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
  const hit = tool === 'select' ? 'auto' : 'none'

  return (
    <div
      ref={root}
      onPointerDown={onRootDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
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

      {shown.map((i) => {
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
        if (i.kind === 'note') {
          return (
            <div key={i.id} title={i.text || 'Note'} style={{ left: `${i.at.x * 100}%`, top: `${i.at.y * 100}%`, width: 20 * scale, height: 20 * scale, background: i.colour, pointerEvents: hit }} className="absolute rounded-sm border border-black/60 shadow-sm" onPointerDown={(e) => onItemDown(e, i)} />
          )
        }
        return null
      })}

      {sel && tool === 'select' && !editing && <Selection item={sel} scale={scale} size={size} onHandleDown={(e, h) => onHandleDown(e, sel, h)} />}
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
  const pictures = items.filter((i) => i.kind === 'image')
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

/** the outline of the selected item, with its handles */
function Selection({ item, scale, size, onHandleDown }: { item: Item; scale: number; size: { width: number; height: number }; onHandleDown: (e: ReactPointerEvent, h: Handle | 'from' | 'to') => void }) {
  const handle = (key: string, x: number, y: number, h: Handle | 'from' | 'to', label: string) => (
    <button
      key={key}
      type="button"
      aria-label={label}
      onPointerDown={(e) => onHandleDown(e, h)}
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-accent bg-surface pointer-coarse:size-6"
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
  if (!('box' in item)) return outline
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
