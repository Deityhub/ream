// Form fields between the file and the editor: the file's fields as items (from `readForm`), new fields, and what
// changed, as `editForm` takes it. Plain functions, so they can be tested without a browser.
import type { FieldChange, FieldSpec, FormEdits, FormInfo, WidgetSpec } from '@ream/pdf-core'
import type { Rect } from '../rect.ts'
import type { Suggestion } from './detect.ts'
import { colourOf, isField, type EditPdfOptions, type FieldItem, type FieldType } from './items.ts'

type Size = { width: number; height: number }

const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')

/** the file's fields as items, one per place each is shown (push buttons are left alone, and so are left out) */
export function fieldItems(info: FormInfo, newId: () => string): FieldItem[] {
  const out: FieldItem[] = []
  for (const f of info.fields) {
    if (f.kind === 'button') continue
    const type: FieldType = f.kind === 'text' ? (f.dateFormat ? 'date' : 'text') : f.kind === 'choice' ? (f.combo ? 'dropdown' : 'list') : f.kind
    f.widgets.forEach((w, i) => {
      if (w.page === null || !w.box) return
      out.push({
        id: newId(),
        page: w.page,
        kind: 'field',
        box: w.box,
        type,
        name: f.name,
        state: w.state ?? '',
        value: f.value,
        tooltip: f.tooltip,
        required: f.required,
        readOnly: f.readOnly,
        multiline: f.multiline,
        password: f.password,
        comb: f.comb,
        maxLength: f.maxLength,
        fontSize: f.fontSize,
        align: f.align as 0 | 1 | 2,
        textColour: hex(f.textColour),
        border: f.border && hex(f.border),
        borderWidth: f.borderWidth,
        background: f.background && hex(f.background),
        options: f.kind === 'choice' ? f.options : [],
        editable: f.editable,
        dateFormat: f.dateFormat ?? '',
        source: { name: f.name, widget: i },
        locked: f.unsupported && f.kind !== 'signature',
      })
    })
  }
  return out
}

const BASE: Record<FieldType, string> = { text: 'Text', date: 'Date', checkbox: 'Checkbox', radio: 'Choice', dropdown: 'Dropdown', list: 'List', signature: 'Signature' }

/** a name no field has yet: Text 1, Text 2, … */
export function freeName(base: string, items: { name?: string; kind: string }[]): string {
  const taken = new Set(items.flatMap((i) => (i.kind === 'field' && i.name ? [i.name] : [])))
  for (let n = 1; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

/** fields for what Find fields suggested, named after their labels (Email, Email 2, …) */
export function suggestedFields(found: Suggestion[], page: number, items: FieldItem[], newId: () => string): FieldItem[] {
  const out: FieldItem[] = []
  for (const s of found) {
    const all = [...items, ...out]
    // a line labelled as one is a signature or a date
    const type = s.type !== 'text' ? s.type : /signature|sign here/i.test(s.label) ? 'signature' : /\bdate\b|^dob$/i.test(s.label) ? 'date' : 'text'
    const f = newField(newId(), page, type, s.box, all, null)
    if (s.label) f.name = all.some((i) => i.name === s.label) ? freeName(s.label, all).replace(/ 1$/, ' 2') : s.label
    out.push(f)
  }
  return out
}

/** a value no button of the group stands for yet */
const freeState = (group: FieldItem[]) => {
  for (let n = group.length + 1; ; n++) if (!group.some((g) => g.state === `Choice ${n}`)) return `Choice ${n}`
}

/** the box a click makes for each kind of field, in points */
export const FIELD_SIZE: Record<FieldType, [number, number]> = { text: [160, 20], date: [90, 20], checkbox: [14, 14], radio: [14, 14], dropdown: [140, 20], list: [140, 60], signature: [180, 40] }

/**
 * A new field. A radio button joins the group of the radio button that is selected (`join`), taking its settings;
 * otherwise it starts a group of its own.
 */
export function newField(id: string, page: number, type: FieldType, box: Rect, items: FieldItem[], join: FieldItem | null): FieldItem {
  if (type === 'radio' && join?.type === 'radio') {
    const group = items.filter((i) => i.name === join.name)
    return { ...join, id, page, box, state: freeState(group), source: undefined, everyPage: undefined }
  }
  return {
    id,
    page,
    kind: 'field',
    box,
    type,
    name: freeName(BASE[type], items),
    state: type === 'radio' ? 'Choice 1' : '',
    value: type === 'checkbox' ? false : '',
    tooltip: '',
    required: false,
    readOnly: false,
    multiline: false,
    password: false,
    comb: false,
    maxLength: null,
    fontSize: 0,
    align: 0,
    textColour: '#000000',
    border: '#000000',
    borderWidth: 1,
    background: null,
    options: type === 'dropdown' || type === 'list' ? [{ value: 'First', label: 'First' }, { value: 'Second', label: 'Second' }] : [],
    editable: false,
    dateFormat: type === 'date' ? 'dd/mm/yyyy' : '',
  }
}

/** a copy of a field somewhere else: a radio button joins its group, anything else becomes a field of its own */
export function copiedField(item: FieldItem, id: string, items: FieldItem[]): FieldItem {
  if (item.type === 'radio') return { ...item, id, state: freeState(items.filter((i) => i.name === item.name)), source: undefined }
  return { ...item, id, name: freeName(item.name.replace(/ \d+$/, ''), items), source: undefined }
}

/** the field's own settings, the same on all its items (not its place or the value a radio button stands for) */
const FIELD_KEYS = ['name', 'type', 'value', 'tooltip', 'required', 'readOnly', 'multiline', 'password', 'comb', 'maxLength', 'fontSize', 'align', 'textColour', 'border', 'borderWidth', 'background', 'options', 'editable', 'dateFormat'] as const
export type FieldSettings = Pick<FieldItem, (typeof FIELD_KEYS)[number]>
export const settingsOf = (i: FieldItem): FieldSettings => Object.fromEntries(FIELD_KEYS.map((k) => [k, i[k]])) as FieldSettings
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function groups(items: FieldItem[]): Map<string, FieldItem[]> {
  const out = new Map<string, FieldItem[]>()
  for (const i of items) out.set(i.name, [...(out.get(i.name) ?? []), i])
  return out
}

/** a box as fractions of the displayed page to displayed points from the bottom left */
const rectOf = (b: Rect, s: Size): WidgetSpec['rect'] => [b.x * s.width, (1 - b.y - b.h) * s.height, (b.x + b.w) * s.width, (1 - b.y) * s.height]

function specOf(items: FieldItem[], sizes: Size[]): FieldSpec {
  const f = items[0]
  return {
    ...settingsOf(f),
    name: f.name.trim(),
    textColour: colourOf(f.textColour),
    border: f.border ? colourOf(f.border) : null,
    background: f.background ? colourOf(f.background) : null,
    options: f.options.filter((o) => o.value.trim()),
    widgets: items.map((i) => ({ page: i.page, rect: rectOf(i.box, sizes[i.page]), state: i.type === 'radio' ? i.state : undefined, from: i.source?.widget })),
  }
}

/** what changed between the fields the file had and the items now: as `editForm` takes it, or null for nothing */
export function formEdits(o: Pick<EditPdfOptions, 'items' | 'fieldsLoaded' | 'tabOrder'>, sizes: Size[]): FormEdits | null {
  const now = groups(o.items.filter(isField))
  const was = groups(o.fieldsLoaded)
  const edits: Required<Omit<FormEdits, 'order'>> & Pick<FormEdits, 'order'> = { add: [], change: [], remove: [] }
  const left = new Set<string>() // names of fields that are as they were
  for (const [name, before] of was) {
    const entry = [...now].find(([, items]) => items.some((i) => i.source?.name === name))
    if (!entry) {
      edits.remove.push(name)
      continue
    }
    const items = entry[1]
    const strip = ({ id: _id, ...rest }: FieldItem) => rest
    if (items.length === before.length && items.every((i, k) => same(strip(i), strip(before[k])))) {
      left.add(name)
      continue
    }
    const old = (i: FieldItem) => before.find((b) => b.source?.widget === i.source?.widget && i.source)
    const redraw = !same(settingsOf({ ...items[0], name }), settingsOf(before[0])) || items.some((i) => {
      const b = old(i)
      return !b || b.state !== i.state || Math.abs(b.box.w - i.box.w) > 1e-6 || Math.abs(b.box.h - i.box.h) > 1e-6 || b.page !== i.page
    })
    edits.change.push({ ...specOf(items, sizes), was: name, redraw } satisfies FieldChange)
  }
  for (const [, items] of now) if (!items.some((i) => i.source)) edits.add.push(specOf(items, sizes))

  const pages = Object.entries(o.tabOrder).filter(([, ids]) => ids.length)
  if (pages.length) {
    edits.order = new Map()
    for (const [page, ids] of pages) {
      const keys = ids.flatMap((id) => {
        const item = o.items.find((i) => i.id === id)
        if (!item || !isField(item)) return []
        const widget = left.has(item.name) ? item.source!.widget : now.get(item.name)!.indexOf(item)
        return [{ name: item.name.trim(), widget }]
      })
      edits.order.set(Number(page), keys)
    }
  }
  return edits.add.length || edits.change.length || edits.remove.length || edits.order ? edits : null
}

/** the fields of a page in reading order: rows from the top (fields whose middles are within half a field's height), left to right */
export function byPosition(items: FieldItem[]): FieldItem[] {
  const mid = (i: FieldItem) => i.box.y + i.box.h / 2
  return [...items].sort((a, b) => (Math.abs(mid(a) - mid(b)) < Math.min(a.box.h, b.box.h) / 2 ? a.box.x - b.box.x : mid(a) - mid(b)))
}
