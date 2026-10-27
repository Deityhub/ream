// Making, changing and removing form fields (Edit PDF's forms mode). Written through `editDocument`, so everything else
// in the file is kept. Places come in displayed points (origin bottom left, rotation applied), like `decorate`.
import { PdfRef, PdfStream, PdfString, isDict, name, type PdfDict, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'
import { decodeTextString, encodeTextString } from './info.ts'
import { PdfRangeError } from './errors.ts'
import { editDocument } from './rewrite.ts'
import { displayedToUser } from './edit.ts'
import { checkAppearance, listAppearance, textAppearance, type FontLook, type Look } from './appearance.ts'
import {
  COMB,
  COMBO,
  EDIT,
  MULTILINE,
  PASSWORD,
  RADIO,
  READ_ONLY,
  REQUIRED,
  dateFormatOf,
  editableForm,
  fontLook,
  kindOf,
  listShownFields,
  num,
  onStates,
  parseDefaultAppearance,
  pruneFields,
  terminalFields,
  type FieldKind,
  type Terminal,
} from './forms.ts'

export type FieldType = 'text' | 'date' | 'checkbox' | 'radio' | 'dropdown' | 'list' | 'signature'
type RGB = [number, number, number]

export type WidgetSpec = {
  page: number
  /** displayed points: left, bottom, right, top */
  rect: [number, number, number, number]
  /** radio buttons: the value this button stands for */
  state?: string
  /** in a change: which of the field's widgets (in `readForm`'s order) this is; none for a new one */
  from?: number
}

export type FieldSpec = {
  /** the full name */
  name: string
  type: FieldType
  widgets: WidgetSpec[]
  /** text: the text; checkbox: on or off; radio: the chosen button's value; choices: the chosen entry's value */
  value: string | boolean
  tooltip: string
  required: boolean
  readOnly: boolean
  multiline: boolean
  password: boolean
  comb: boolean
  maxLength: number | null
  /** points, 0 for as big as fits */
  fontSize: number
  /** 0 left, 1 centre, 2 right */
  align: number
  textColour: RGB
  border: RGB | null
  borderWidth: number
  background: RGB | null
  options: { value: string; label: string }[]
  /** a drop-down that also takes text of one's own */
  editable: boolean
  /** date fields: as Acrobat's AFDate_FormatEx takes it, e.g. dd/mm/yyyy */
  dateFormat: string
}

export type FieldChange = FieldSpec & {
  /** the field's name in the file */
  was: string
  /** draw its widgets again (false when only places or the name changed) */
  redraw: boolean
}

export type FormEdits = {
  add?: FieldSpec[]
  change?: FieldChange[]
  remove?: string[]
  /** per page, the order Tab goes through its fields: a field's (new) name and a widget index (into the spec's widgets, or `readForm`'s for a field left alone) */
  order?: Map<number, { name: string; widget: number }[]>
}

const FT: Record<FieldType, string> = { text: 'Tx', date: 'Tx', checkbox: 'Btn', radio: 'Btn', dropdown: 'Ch', list: 'Ch', signature: 'Sig' }
const BASE: Record<FieldType, FieldKind> = { text: 'text', date: 'text', checkbox: 'checkbox', radio: 'radio', dropdown: 'choice', list: 'choice', signature: 'signature' }
const NO_TOGGLE_TO_OFF = 1 << 14
const MANAGED = READ_ONLY | REQUIRED | MULTILINE | PASSWORD | COMB | COMBO | EDIT

const c3 = (c: RGB) => c.map((v) => +Math.min(1, Math.max(0, v)).toFixed(3)).join(' ')
const arrayOf = (doc: PdfDocument, o: PdfObj | undefined): PdfObj[] => {
  const a = doc.resolve(o)
  return Array.isArray(a) ? [...a] : []
}
const prefixOf = (n: string) => n.slice(0, n.lastIndexOf('.') + 1)

function flags(f: FieldSpec, old: number): number {
  let ff = old & ~MANAGED
  if (f.readOnly) ff |= READ_ONLY
  if (f.required) ff |= REQUIRED
  if (f.type === 'text') {
    if (f.multiline) ff |= MULTILINE
    if (f.password) ff |= PASSWORD
    if (f.comb && f.maxLength) ff |= COMB
  }
  if (f.type === 'dropdown') ff |= COMBO | (f.editable ? EDIT : 0)
  if (f.type === 'radio') ff |= RADIO | NO_TOGGLE_TO_OFF
  return ff
}

const js = (code: string) => new Map<string, PdfObj>([['S', name('JavaScript')], ['JS', encodeTextString(code)]])

/** the field's own settings on its dictionary (a private copy) */
function setField(doc: PdfDocument, d: PdfDict, f: FieldSpec, fontName: string, oldFf: number, on: string) {
  d.set('FT', name(FT[f.type]))
  d.set('Ff', flags(f, oldFf))
  if (f.tooltip) d.set('TU', encodeTextString(f.tooltip))
  else d.delete('TU')
  const check = f.type === 'checkbox' || f.type === 'radio'
  d.set('DA', encodeTextString(check ? '/ZaDb 0 Tf 0 g' : `/${fontName} ${+f.fontSize.toFixed(2)} Tf ${c3(f.textColour)} rg`))
  if (!check) d.set('Q', f.align)
  if (f.type === 'text' && f.maxLength && f.maxLength > 0) d.set('MaxLen', Math.round(f.maxLength))
  else d.delete('MaxLen')
  if (f.type === 'dropdown' || f.type === 'list') d.set('Opt', f.options.map((o) => (o.label && o.label !== o.value ? [encodeTextString(o.value), encodeTextString(o.label)] : encodeTextString(o.value))))
  if (f.type === 'date') {
    const fmt = JSON.stringify(f.dateFormat || 'dd/mm/yyyy')
    d.set('AA', new Map<string, PdfObj>([['F', js(`AFDate_FormatEx(${fmt});`)], ['K', js(`AFDate_KeystrokeEx(${fmt});`)]]))
  } else if (f.type === 'text' && dateFormatOf(doc, { dict: d } as Terminal)) d.delete('AA')
  if (f.type === 'checkbox') d.set('V', name(f.value === true ? on : 'Off'))
  else if (f.type === 'radio') d.set('V', name(typeof f.value === 'string' && f.value ? f.value : 'Off'))
  else if (f.type !== 'signature') {
    if (f.value) d.set('V', encodeTextString(String(f.value)))
    else d.delete('V')
  }
}

type Place = { page: number; ref: PdfRef; pageRef: PdfRef; rect: number[]; rotate: number; size: [number, number] }

export async function editForm(doc: PdfDocument, edits: FormEdits): Promise<Uint8Array> {
  const terminals = terminalFields(doc)
  const byName = new Map(terminals.map((t) => [t.name, t]))
  const add = edits.add ?? []
  const change = edits.change ?? []
  const remove = edits.remove ?? []
  const pages = doc.pages()
  for (const n of [...remove, ...change.map((c) => c.was)]) if (!byName.has(n)) throw new PdfRangeError(`This form has no field named "${n}".`)
  const taken = new Set(terminals.map((t) => t.name))
  for (const n of [...remove, ...change.map((c) => c.was)]) taken.delete(n)
  for (const f of [...change, ...add]) {
    if (!f.name.trim()) throw new PdfRangeError('Every field needs a name.')
    if (taken.has(f.name)) throw new PdfRangeError(`There are two fields named "${f.name}". Give each field a name of its own.`)
    taken.add(f.name)
    if (!f.widgets.length) throw new PdfRangeError(`The field "${f.name}" isn't on any page.`)
    if (f.widgets.some((w) => !pages[w.page])) throw new PdfRangeError(`The field "${f.name}" is on a page this PDF does not have.`)
    if (f.widgets.some((w) => w.rect[2] - w.rect[0] <= 0 || w.rect[3] - w.rect[1] <= 0)) throw new PdfRangeError(`The field "${f.name}" has no size.`)
    if (f.type === 'radio' && f.widgets.some((w) => !w.state)) throw new PdfRangeError(`Every button of "${f.name}" needs a value.`)
  }
  for (const f of add) if (f.name.includes('.')) throw new PdfRangeError(`"${f.name}": a field's name can't have a dot in it.`)
  for (const c of change) {
    const t = byName.get(c.was)!
    if (!t.ref) throw new PdfRangeError(`The field "${c.was}" can't be changed in this file.`)
    if (BASE[c.type] !== kindOf(doc, t)) throw new PdfRangeError(`The field "${c.was}" can't become another kind of field. Delete it and add a new one.`)
    if (c.name !== c.was && (prefixOf(c.name) !== prefixOf(c.was) || c.name.slice(prefixOf(c.was).length).includes('.'))) throw new PdfRangeError(`"${c.was}" can only be renamed within its group, without dots.`)
    if (!c.widgets.some((w) => w.from !== undefined && t.widgets[w.from]?.ref)) throw new PdfRangeError(`The field "${c.was}" can't be changed in this file.`)
  }

  return editDocument(doc, (e) => {
    const fonts = new Map<string, FontLook>()
    const gone = new Set<number>()
    for (const n of remove) {
      const t = byName.get(n)!
      for (const w of t.widgets) if (w.ref) gone.add(w.ref.num)
      if (t.ref) gone.add(t.ref.num)
    }
    for (const c of change) {
      const t = byName.get(c.was)!
      const used = new Set(c.widgets.map((w) => w.from))
      t.widgets.forEach((w, i) => w.ref && !used.has(i) && gone.add(w.ref.num))
    }
    pruneFields(doc, e, gone)
    listShownFields(doc, e, terminals)
    const form = editableForm(e)
    if (!form.has('DA')) form.set('DA', encodeTextString('/Helv 0 Tf 0 g'))

    const placed: Place[] = []
    const key = new Map<string, PdfRef>()
    const place = (page: number, ref: PdfRef, r: WidgetSpec['rect']): Place => {
      const p = pages[page]
      const { box, rotate } = doc.pageBox(p)
      const m = displayedToUser(box, rotate)
      const xs = [r[0], r[2]].flatMap((x) => [r[1], r[3]].map((y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]))
      const rect = [Math.min(...xs.map((v) => v[0])), Math.min(...xs.map((v) => v[1])), Math.max(...xs.map((v) => v[0])), Math.max(...xs.map((v) => v[1]))].map((v) => +v.toFixed(3))
      const at: Place = { page, ref, pageRef: e.pageRefs[page]!, rect, rotate, size: [r[2] - r[0], r[3] - r[1]] }
      placed.push(at)
      return at
    }

    /** a widget's own keys, and its pictures when `draw` */
    const setWidget = (d: PdfDict, f: FieldSpec, at: Place, state: string, draw: boolean, fontName: string) => {
      d.set('Type', name('Annot'))
      d.set('Subtype', name('Widget'))
      d.set('Rect', at.rect)
      d.set('P', at.pageRef)
      if (!d.has('F')) d.set('F', 4)
      const mk = new Map(isDict(doc.resolve(d.get('MK'))) ? (doc.resolve(d.get('MK')) as PdfDict) : [])
      if (f.border) mk.set('BC', f.border.map((v) => +v.toFixed(3)))
      else mk.delete('BC')
      if (f.background) mk.set('BG', f.background.map((v) => +v.toFixed(3)))
      else mk.delete('BG')
      if (at.rotate) mk.set('R', at.rotate)
      else mk.delete('R')
      if (f.type === 'checkbox') mk.set('CA', encodeTextString('4'))
      if (f.type === 'radio') mk.set('CA', encodeTextString('l'))
      d.set('MK', mk)
      d.set('BS', new Map<string, PdfObj>([['W', f.border ? f.borderWidth : 0], ['S', name('S')]]))
      const check = f.type === 'checkbox' || f.type === 'radio'
      if (check) d.set('AS', name(f.type === 'checkbox' ? (f.value === true ? state : 'Off') : f.value === state ? state : 'Off'))
      if (!draw) return
      const [w, h] = at.size
      const look: Look = {
        fontName,
        size: f.fontSize,
        colour: `${c3(f.textColour)} rg`,
        align: f.align,
        multiline: f.type === 'text' && f.multiline,
        comb: f.type === 'text' && f.comb && !!f.maxLength,
        maxLength: f.maxLength ?? 0,
        password: f.type === 'text' && f.password,
        background: f.background ? `${c3(f.background)} rg` : null,
        border: f.border && f.borderWidth > 0 ? { colour: `${c3(f.border)} RG`, width: f.borderWidth } : null,
      }
      // the picture is drawn upright as the page is shown, then turned into the page's own space
      const turn = (s: PdfStream) => {
        if (at.rotate) s.dict.set('Matrix', displayedToUser([0, 0, at.rect[2] - at.rect[0], at.rect[3] - at.rect[1]], at.rotate))
        return e.add(s)
      }
      if (check) {
        const yes = turn(checkAppearance(w, h, { ...look, colour: `${c3(f.textColour)} rg` }, f.type as 'checkbox' | 'radio', true))
        const off = turn(checkAppearance(w, h, look, f.type as 'checkbox' | 'radio', false))
        d.set('AP', new Map<string, PdfObj>([['N', new Map<string, PdfObj>([[state, yes], ['Off', off]])]]))
        return
      }
      const font = fontLook(doc, e, fontName, fonts)
      const value = String(f.value)
      try {
        const picture =
          f.type === 'list'
            ? listAppearance(w, h, f.options.map((o) => o.label || o.value), f.options.findIndex((o) => o.value === value), look, font)
            : textAppearance(w, h, f.type === 'dropdown' ? (f.options.find((o) => o.value === value)?.label || value) : f.type === 'signature' ? '' : value, look, font)
        d.set('AP', new Map<string, PdfObj>([['N', turn(picture)]]))
      } catch (err) {
        if (err instanceof PdfRangeError) throw new PdfRangeError(`The field "${f.name}" can't show some of its text: form fields take Latin letters, digits and common symbols.`)
        throw err
      }
    }

    for (const c of change) {
      const t = byName.get(c.was)!
      const field = e.edit(t.ref!)
      if (c.name !== c.was) field.set('T', encodeTextString(c.name.slice(prefixOf(c.name).length)))
      const da = t.attr('DA')
      const fontName = parseDefaultAppearance(da instanceof PdfString ? decodeTextString(da.bytes) : '').font
      const firstOn = (t.widgets[0] && onStates(doc, t.widgets[0])[0]) || 'Yes'
      setField(doc, field, c, fontName, num(t.attr('Ff')), firstOn)
      const kids: PdfRef[] = []
      c.widgets.forEach((w, i) => {
        const old = w.from !== undefined ? t.widgets[w.from] : undefined
        let ref: PdfRef
        let d: PdfDict
        if (old?.ref) {
          ref = old.ref
          d = e.edit(ref)
        } else {
          if (t.widgets.some((x) => x.ref?.num === t.ref!.num)) throw new PdfRangeError(`"${c.name}" can't take another widget in this file.`)
          ref = e.reserve()
          d = new Map<string, PdfObj>([['Parent', t.ref!]])
          e.set(ref, d)
          kids.push(ref)
        }
        const had = old ? onStates(doc, old)[0] : undefined
        const state = c.type === 'radio' ? w.state! : had || 'Yes'
        const draw = c.redraw || !old || !isDict(doc.resolve(old.dict.get('AP'))) || (c.type === 'radio' && had !== state)
        setWidget(d, c, place(w.page, ref, w.rect), state, draw, fontName)
        key.set(`${c.name}#${i}`, ref)
      })
      if (kids.length) field.set('Kids', [...arrayOf(doc, field.get('Kids')), ...kids])
    }

    const fresh: PdfRef[] = []
    for (const f of add) {
      const fieldRef = e.reserve()
      const field: PdfDict = new Map([['T', encodeTextString(f.name)]])
      setField(doc, field, f, 'Helv', 0, 'Yes')
      const merged = f.widgets.length === 1 && f.type !== 'radio'
      const kids: PdfRef[] = []
      f.widgets.forEach((w, i) => {
        const ref = merged ? fieldRef : e.reserve()
        const d: PdfDict = merged ? field : new Map<string, PdfObj>([['Parent', fieldRef]])
        if (!merged) e.set(ref, d)
        setWidget(d, f, place(w.page, ref, w.rect), f.type === 'radio' ? w.state! : 'Yes', true, 'Helv')
        kids.push(ref)
        key.set(`${f.name}#${i}`, ref)
      })
      if (!merged) field.set('Kids', kids)
      e.set(fieldRef, field)
      fresh.push(fieldRef)
    }
    if (fresh.length) form.set('Fields', [...arrayOf(doc, form.get('Fields')), ...fresh])
    if (add.length || change.length) {
      // the fonts the fields name, in the form's default resources, for viewers that draw fields themselves
      const dr: PdfDict = new Map(isDict(doc.resolve(form.get('DR'))) ? (doc.resolve(form.get('DR')) as PdfDict) : [])
      const drFonts: PdfDict = new Map(isDict(doc.resolve(dr.get('Font'))) ? (doc.resolve(dr.get('Font')) as PdfDict) : [])
      if (!drFonts.has('Helv')) drFonts.set('Helv', fontLook(doc, e, 'Helv', fonts).ref)
      if (!drFonts.has('ZaDb')) drFonts.set('ZaDb', e.add(new Map<string, PdfObj>([['Type', name('Font')], ['Subtype', name('Type1')], ['BaseFont', name('ZapfDingbats')]])))
      dr.set('Font', drFonts)
      form.set('DR', dr)
    }
    for (const t of terminals) {
      if (remove.includes(t.name) || change.some((c) => c.was === t.name)) continue
      t.widgets.forEach((w, i) => w.ref && key.set(`${t.name}#${i}`, w.ref))
    }

    // each page's annotations: removed and moved widgets out, new and moved ones in, then the Tab order
    const target = new Map(placed.map((p) => [p.ref.num, p.page]))
    pages.forEach((page, index) => {
      const pageRef = e.pageRefs[index]
      if (!pageRef) return
      const before = arrayOf(doc, page.dict.get('Annots'))
      const list = before.filter((a) => !(a instanceof PdfRef && (gone.has(a.num) || (target.has(a.num) && target.get(a.num) !== index))))
      for (const p of placed) if (p.page === index && !list.some((a) => a instanceof PdfRef && a.num === p.ref.num)) list.push(p.ref)
      const order = edits.order?.get(index)
      if (order) {
        const rank = new Map<number, number>()
        order.forEach((k, i) => {
          const r = key.get(`${k.name}#${k.widget}`)
          if (r && !rank.has(r.num)) rank.set(r.num, i)
        })
        const slots = list.flatMap((a, i) => (a instanceof PdfRef && rank.has(a.num) ? [i] : []))
        const sorted = slots.map((i) => list[i] as PdfRef).sort((a, b) => rank.get(a.num)! - rank.get(b.num)!)
        slots.forEach((s, j) => (list[s] = sorted[j]))
      }
      const same = list.length === before.length && list.every((a, i) => a === before[i])
      if (same && !order) return
      const d = e.edit(pageRef)
      d.set('Annots', list)
      // without /Tabs viewers go through the fields in the order of the page's annotations
      if (order) d.delete('Tabs')
    })
  })
}
