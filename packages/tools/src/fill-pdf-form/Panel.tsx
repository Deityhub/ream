import { useEffect, useState, type CSSProperties } from 'react'
import type { FormField, FormInfo } from '@ream/pdf-core'
import { inputClass } from '../fields.tsx'
import type { PanelProps } from '../panels.ts'
import { usePageZoom } from '../PageZoom.tsx'
import { defaultOptions, unwritable, type FillFormOptions as O } from './values.ts'

export { defaultOptions }
export const placesActions = true

type Size = { width: number; height: number }
const button = 'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 pointer-coarse:min-h-11'
// controls over the page: the page's own field shows through a little, the typed value reads clearly
const onPage = 'absolute m-0 box-border [color-scheme:light] rounded-[2px] border border-accent bg-white/85 px-[0.3em] text-black focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60'
const KIND: Record<FormField['kind'], string> = { text: 'Text', checkbox: 'Tick box', radio: 'Choice of buttons', choice: 'List', button: 'Button', signature: 'Signature' }

export function Panel({ options: o, onChange, files, pdfHost, actions }: PanelProps<O>) {
  const file = files[0]
  const [pages, setPages] = useState<Size[] | null>(null)
  const [form, setForm] = useState<FormInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const [current, setCurrent] = useState(0)
  const [focus, setFocus] = useState<string | null>(null)

  useEffect(() => {
    setPages(null)
    setForm(null)
    setFailed(false)
    setCurrent(0)
    onChange(defaultOptions)
    if (!file || !pdfHost) return
    let live = true
    Promise.all([pdfHost.pages(file), pdfHost.form(file)]).then(
      ([p, f]) => {
        if (!live) return
        setPages(p)
        setForm(f)
        // start on the first page that has a field
        const first = f.fields.flatMap((x) => x.widgets.map((w) => w.page)).find((n): n is number => n !== null)
        if (first !== undefined) setCurrent(first)
      },
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // the control of a field chosen in the list, once its page is shown
  useEffect(() => {
    if (!focus) return
    const id = requestAnimationFrame(() => document.getElementById(focus)?.focus())
    return () => cancelAnimationFrame(id)
  }, [focus, current])

  // the page's zoom (the whole page in view to start with)
  const zoom = usePageZoom(pages ? pages[Math.min(current, pages.length - 1)] : undefined, file)

  if (!file || !pdfHost) return <Waiting actions={actions}>Add a PDF form, then type into its fields on the page.</Waiting>
  if (failed) return <Waiting actions={actions}>This PDF can't be shown here, so its fields can't be filled in.</Waiting>
  if (!pages || !form) return <Waiting actions={actions}>Reading the form…</Waiting>
  if (!form.fields.length) {
    return <Waiting actions={actions}>{form.xfa ? "This is an XFA form, a kind Ream can't fill in. Open it in Adobe Acrobat or Reader." : 'This PDF has no form fields to fill in.'}</Waiting>
  }

  const { PdfPage } = pdfHost
  const size = pages[Math.min(current, pages.length - 1)]
  const valueOf = (f: FormField) => (f.name in o.values ? o.values[f.name] : f.value)
  // only what differs from the file is kept, so untouched fields stay exactly as they were
  const set = (f: FormField, v: string | boolean) => {
    const values = { ...o.values }
    if (v === f.value) delete values[f.name]
    else values[f.name] = v
    onChange({ ...o, values })
  }
  const changed = Object.keys(o.values).length
  const fillable = (f: FormField) => !f.unsupported && !f.readOnly
  const go = (by: number) => setCurrent((c) => Math.min(pages.length - 1, Math.max(0, c + by)))
  const idOf = (i: number, w: number) => `field-${i}-${w}`
  const show = (i: number) => {
    const f = form.fields[i]
    const w = f.widgets.findIndex((x) => x.page !== null && x.box)
    if (w < 0) return
    setCurrent(f.widgets[w].page!)
    setFocus(idOf(i, w))
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div className="min-w-0 space-y-3 rounded-xl border border-line bg-surface p-4">
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
          <div className="relative mx-auto [container-type:size]" style={{ aspectRatio: `${size.width} / ${size.height}`, width: zoom.width || '100%' }}>
            <PdfPage key={current} file={file} page={current} renderWidth={zoom.renderWidth} />
            {form.fields.map((f, i) =>
              f.unsupported
                ? null
                : f.widgets.map((w, k) => {
                    if (w.page !== current || !w.box) return null
                    const style: CSSProperties = { left: `${w.box.x * 100}%`, top: `${w.box.y * 100}%`, width: `${w.box.w * 100}%`, height: `${w.box.h * 100}%`, fontSize: `min(${w.box.h * 60}cqh, 2.6cqh)` }
                    return <FieldControl key={`${i}-${k}`} id={idOf(i, k)} field={f} state={w.state} value={valueOf(f)} onChange={(v) => set(f, v)} className={onPage} style={style} />
                  }),
            )}
          </div>
        </div>
        <p className="text-xs text-muted">Click a field on the page to fill it in. The list of fields has every one, including any you can't reach on the page.</p>
      </div>

      <div className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">
            {form.fields.length} {form.fields.length === 1 ? 'field' : 'fields'}
          </span>
          <button type="button" onClick={() => onChange({ ...o, values: {} })} disabled={!changed} className={button}>
            Reset to the file's values
          </button>
        </div>
        <ul className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {form.fields.map((f, i) => {
            const v = valueOf(f)
            const bad = typeof v === 'string' ? unwritable(v) : []
            const placed = f.widgets.find((w) => w.page !== null && w.box)
            return (
              <li key={f.name} className="space-y-1 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <button type="button" onClick={() => show(i)} disabled={!placed} className="min-w-0 break-words text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-accent disabled:no-underline">
                    {f.name}
                  </button>
                  <span className="text-xs text-muted">
                    {KIND[f.kind]}
                    {placed ? `, page ${placed.page! + 1}` : ''}
                    {f.name in o.values ? ', changed' : ''}
                  </span>
                </div>
                {fillable(f) ? (
                  <FieldControl id={`list-${i}`} field={f} state={null} value={v} onChange={(x) => set(f, x)} className={`${inputClass} w-full`} list />
                ) : (
                  <p className="text-xs text-muted">{f.readOnly ? 'Read only: the form doesn’t let this be changed.' : f.kind === 'signature' ? 'Signature fields are not signed here; Sign PDF adds a visible signature.' : "Ream can't fill in this kind of field."}</p>
                )}
                {bad.length > 0 && (
                  <p className="text-xs text-danger">
                    {bad.join(' ')} can't be written in this form. Fields take Western European letters only.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={o.lock} onChange={(e) => onChange({ ...o, lock: e.target.checked })} className="mt-0.5" />
          <span>
            Lock the answers
            <span className="block text-xs text-muted">The answers are drawn into the pages and the fields removed, so nobody can change them, as some portals and printers ask. Keep a copy that isn't locked if you may need to edit it.</span>
          </span>
        </label>
        <p className="text-sm text-muted" role="status">
          {changed === 0 ? 'Values already in the file are shown; change any of them.' : `${changed} ${changed === 1 ? 'field' : 'fields'} changed.`}
        </p>
        {actions}
      </div>
    </div>
  )
}

/** the control for one field: on the page for one widget (a radio button stands for its `state`), or in the list for the whole field */
function FieldControl({ id, field: f, state, value, onChange, className, style, list }: { id: string; field: FormField; state: string | null; value: string | boolean; onChange: (v: string | boolean) => void; className: string; style?: CSSProperties; list?: boolean }) {
  const disabled = f.readOnly
  const label = f.name
  if (f.kind === 'checkbox') {
    const box = <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} className={list ? 'size-4' : 'absolute m-0 accent-accent [color-scheme:light]'} style={style} />
    return list ? <label className="flex items-center gap-2 text-sm">{box} Ticked</label> : box
  }
  if (f.kind === 'radio') {
    if (list) {
      return (
        <select id={id} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label} className={className}>
          <option value="">None chosen</option>
          {f.options.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
      )
    }
    return <input id={id} type="radio" name={`radio-${f.name}`} checked={state !== null && value === state} disabled={disabled} onChange={() => state && onChange(state)} aria-label={`${label}: ${f.options.find((x) => x.value === state)?.label ?? state}`} className="absolute m-0 accent-accent [color-scheme:light]" style={style} />
  }
  if (f.kind === 'choice') {
    if (f.editable) {
      return (
        <>
          <input id={id} list={`${id}-options`} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label} className={className} style={style} />
          <datalist id={`${id}-options`}>
            {f.options.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </datalist>
        </>
      )
    }
    const known = f.options.some((x) => x.value === value)
    return (
      <select id={id} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label} className={className} style={style}>
        <option value="">{list ? 'None chosen' : ''}</option>
        {/* a value the file has that is not among the entries is still shown */}
        {!known && value !== '' && <option value={String(value)}>{String(value)}</option>}
        {f.options.map((x) => (
          <option key={x.value} value={x.value}>
            {x.label}
          </option>
        ))}
      </select>
    )
  }
  const common = { id, value: String(value), disabled, maxLength: f.maxLength ?? undefined, 'aria-label': label, className, style }
  if (f.multiline) return <textarea {...common} onChange={(e) => onChange(e.target.value)} rows={list ? 3 : undefined} />
  return <input {...common} type={f.password ? 'password' : 'text'} onChange={(e) => onChange(e.target.value)} />
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
