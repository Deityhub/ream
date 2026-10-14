// Interactive form fields (AcroForm): reading them as plain data and filling them in. Everything else in the file is kept.
import { PdfName, PdfRef, PdfStream, PdfString, isDict, isName, name, type PdfDict, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'
import { decodeTextString, encodeTextString } from './info.ts'
import { PdfRangeError } from './errors.ts'
import { editDocument, type Editing } from './rewrite.ts'
import { checkAppearance, markFont, textAppearance, type FontLook, type Look } from './appearance.ts'

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'choice' | 'button' | 'signature'

export type FormField = {
  /** the full name, with the names of the groups it sits in joined by dots */
  name: string
  kind: FieldKind
  /** text and choices: the text; checkbox: on or off; radio: the chosen button's value ('' for none) */
  value: string | boolean
  /** radio: the buttons; choice: the entries */
  options: { value: string; label: string }[]
  multiline: boolean
  password: boolean
  comb: boolean
  readOnly: boolean
  /** a drop-down list (choice) rather than a list box */
  combo: boolean
  maxLength: number | null
  /** 0-based page of the first place the field is shown */
  page: number | null
  /** where it is on that page: left, bottom, right, top in points */
  rect: [number, number, number, number] | null
  /** the form says people can't fill it in with these tools (several choices at once, files, ...) */
  unsupported: boolean
}

export type FormInfo = {
  fields: FormField[]
  /** the file has an XFA form (a different, XML based kind) that these tools can't fill */
  xfa: boolean
}

// field flags
const READ_ONLY = 1 << 0
const MULTILINE = 1 << 12
const PASSWORD = 1 << 13
const RADIO = 1 << 15
const PUSH = 1 << 16
const COMBO = 1 << 17
const MULTI_SELECT = 1 << 21
const FILE_SELECT = 1 << 20
const COMB = 1 << 24
const RICH = 1 << 25

const INHERITED = ['FT', 'Ff', 'V', 'DV', 'DA', 'Q', 'MaxLen', 'Opt'] as const

export type Widget = { ref: PdfRef | null; dict: PdfDict }
export type Terminal = {
  name: string
  /** the field's own object (null if it is written inline in its parent) */
  ref: PdfRef | null
  dict: PdfDict
  /** the annotations that show it on pages */
  widgets: Widget[]
  /** an inheritable attribute, from the field or the nearest group above it */
  attr(key: (typeof INHERITED)[number]): PdfObj
}

export const acroForm = (doc: PdfDocument): PdfDict | null => {
  try {
    const f = doc.resolve(doc.catalog().get('AcroForm'))
    return isDict(f) ? f : null
  } catch {
    return null
  }
}

const textOf = (doc: PdfDocument, o: PdfObj | undefined): string => {
  const v = doc.resolve(o)
  return v instanceof PdfString ? decodeTextString(v.bytes) : v instanceof PdfName ? v.value : ''
}

/** every field that holds a value (the leaves of the field tree), in the order the form lists them */
export function terminalFields(doc: PdfDocument): Terminal[] {
  const form = acroForm(doc)
  const top = form && doc.resolve(form.get('Fields'))
  if (!Array.isArray(top)) return []
  const out: Terminal[] = []
  const seen = new Set<PdfDict>()
  const visit = (node: PdfObj, chain: PdfDict[], prefix: string) => {
    const d = doc.resolve(node)
    if (!isDict(d) || seen.has(d) || chain.length > 32) return
    seen.add(d)
    const t = d.has('T') ? textOf(doc, d.get('T')) : ''
    const full = t ? (prefix ? `${prefix}.${t}` : t) : prefix
    const kids = doc.resolve(d.get('Kids'))
    const kidList = (Array.isArray(kids) ? kids : []).map((k): Widget => ({ ref: k instanceof PdfRef ? k : null, dict: doc.resolve(k) as PdfDict })).filter((k) => isDict(k.dict))
    const fieldKids = kidList.filter((k) => k.dict.has('T'))
    const next = [...chain, d]
    if (fieldKids.length) {
      for (const k of fieldKids) visit(k.ref ?? k.dict, next, full)
      return
    }
    const widgets = kidList.length ? kidList : isName(doc.resolve(d.get('Subtype')), 'Widget') ? [{ ref: node instanceof PdfRef ? node : null, dict: d }] : []
    out.push({
      name: full,
      ref: node instanceof PdfRef ? node : null,
      dict: d,
      widgets,
      attr: (key) => {
        for (let i = next.length - 1; i >= 0; i--) if (next[i].has(key)) return doc.resolve(next[i].get(key))
        const f = key === 'DA' || key === 'Q' ? form?.get(key) : undefined
        return doc.resolve(f)
      },
    })
  }
  for (const f of top) visit(f, [], '')
  return out
}

const num = (v: PdfObj) => (typeof v === 'number' ? v : 0)

export function kindOf(t: Terminal): FieldKind {
  const ft = t.attr('FT')
  const ff = num(t.attr('Ff'))
  if (isName(ft, 'Tx')) return 'text'
  if (isName(ft, 'Ch')) return 'choice'
  if (isName(ft, 'Sig')) return 'signature'
  if (isName(ft, 'Btn')) return ff & PUSH ? 'button' : ff & RADIO ? 'radio' : 'checkbox'
  return 'text'
}

/** the names of the appearance states a widget has, besides Off */
export function onStates(doc: PdfDocument, w: Widget): string[] {
  const ap = doc.resolve(w.dict.get('AP'))
  const n = isDict(ap) ? doc.resolve(ap.get('N')) : null
  return isDict(n) ? [...n.keys()].filter((k) => k !== 'Off') : []
}

const rectOf = (doc: PdfDocument, w: Widget): [number, number, number, number] | null => {
  const r = doc.resolve(w.dict.get('Rect'))
  const n = Array.isArray(r) ? r.map((v) => doc.resolve(v)) : []
  if (n.length !== 4 || !n.every((v) => typeof v === 'number')) return null
  const [a, b, c, d] = n as number[]
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]
}

function options(doc: PdfDocument, t: Terminal, kind: FieldKind): { value: string; label: string }[] {
  if (kind === 'radio') {
    const opt = t.attr('Opt')
    const states = t.widgets.map((w) => onStates(doc, w)[0]).filter((s): s is string => !!s)
    return states.map((s, i) => ({ value: s, label: Array.isArray(opt) && opt[i] !== undefined ? textOf(doc, opt[i]) || s : s }))
  }
  if (kind !== 'choice') return []
  const opt = t.attr('Opt')
  return (Array.isArray(opt) ? opt : []).map((o) => {
    const v = doc.resolve(o)
    if (Array.isArray(v)) return { value: textOf(doc, v[0]), label: textOf(doc, v[1]) || textOf(doc, v[0]) }
    return { value: textOf(doc, v), label: textOf(doc, v) }
  })
}

/** the form's fields as plain data, for a panel to show */
export function readForm(doc: PdfDocument): FormInfo {
  const form = acroForm(doc)
  const xfa = !!form && form.has('XFA')
  const pageOf = new Map<number, number>()
  const pages = doc.pages()
  pages.forEach((p, i) => {
    const annots = doc.resolve(p.dict.get('Annots'))
    if (Array.isArray(annots)) for (const a of annots) if (a instanceof PdfRef && !pageOf.has(a.num)) pageOf.set(a.num, i)
  })
  const fields = terminalFields(doc).map((t): FormField => {
    const kind = kindOf(t)
    const ff = num(t.attr('Ff'))
    const v = t.attr('V')
    const first = t.widgets[0]
    const opts = options(doc, t, kind)
    let value: string | boolean = ''
    if (kind === 'checkbox') {
      const on = first ? onStates(doc, first)[0] : undefined
      value = v instanceof PdfName ? v.value !== 'Off' && (!on || v.value === on) : false
    } else if (kind === 'radio') value = v instanceof PdfName && v.value !== 'Off' ? v.value : ''
    else if (kind === 'text' || kind === 'choice') value = Array.isArray(v) ? textOf(doc, v[0]) : isDict(v) ? '' : textOf(doc, v)
    const maxLen = t.attr('MaxLen')
    const page = first?.ref ? (pageOf.get(first.ref.num) ?? null) : t.ref ? (pageOf.get(t.ref.num) ?? null) : null
    return {
      name: t.name,
      kind,
      value,
      options: opts,
      multiline: !!(ff & MULTILINE),
      password: !!(ff & PASSWORD),
      comb: !!(ff & COMB),
      readOnly: !!(ff & READ_ONLY),
      combo: !!(ff & COMBO),
      maxLength: typeof maxLen === 'number' && maxLen > 0 ? maxLen : null,
      page,
      rect: first ? rectOf(doc, first) : null,
      unsupported: kind === 'signature' || kind === 'button' || !!(ff & (MULTI_SELECT | FILE_SELECT | RICH)) || (kind === 'checkbox' && !first),
    }
  })
  return { fields, xfa }
}

// ---------- filling ----------

export type FormValues = Record<string, string | boolean>

/** `/Helv 12 Tf 0 g` -> the font's resource name, its size (0 = fit the box) and the colour operators */
function parseDefaultAppearance(da: string): { font: string; size: number; colour: string } {
  const m = /\/([^\s/]+)\s+([\d.]+)\s+Tf/.exec(da)
  const colour = da.replace(/\/[^\s/]+\s+[\d.]+\s+Tf/, '').trim()
  return { font: m?.[1] ?? 'Helv', size: m ? Number(m[2]) : 0, colour: /^[\d.\s]*(g|rg|k)$/.test(colour) ? colour : '0 g' }
}

const colourOps = (doc: PdfDocument, o: PdfObj | undefined, stroke: boolean): string | null => {
  const a = doc.resolve(o)
  if (!Array.isArray(a)) return null
  const n = a.map((v) => doc.resolve(v))
  if (!n.every((v) => typeof v === 'number')) return null
  const op = n.length === 1 ? 'g' : n.length === 3 ? 'rg' : n.length === 4 ? 'k' : null
  return op ? `${n.join(' ')} ${stroke ? op.toUpperCase() : op}` : null
}

/** how a widget looks: background and border from its /MK and /BS, rotation ignored */
function widgetLook(doc: PdfDocument, t: Terminal, w: Widget, kind: FieldKind): Look {
  const mk = doc.resolve(w.dict.get('MK'))
  const bs = doc.resolve(w.dict.get('BS'))
  const bg = isDict(mk) ? colourOps(doc, mk.get('BG'), false) : null
  const bc = isDict(mk) ? colourOps(doc, mk.get('BC'), true) : null
  const bw = isDict(bs) && typeof doc.resolve(bs.get('W')) === 'number' ? (doc.resolve(bs.get('W')) as number) : 1
  const da = parseDefaultAppearance(textOf(doc, t.attr('DA')) || '/Helv 0 Tf 0 g')
  const ff = num(t.attr('Ff'))
  const q = t.attr('Q')
  const max = t.attr('MaxLen')
  return {
    fontName: da.font,
    size: da.size,
    colour: da.colour,
    align: typeof q === 'number' ? Math.min(2, Math.max(0, q)) : 0,
    multiline: kind === 'text' && !!(ff & MULTILINE),
    comb: kind === 'text' && !!(ff & COMB) && typeof max === 'number' && max > 0,
    maxLength: typeof max === 'number' ? max : 0,
    password: !!(ff & PASSWORD),
    background: bg,
    border: bc ? { colour: bc, width: bw } : null,
  }
}

/** the form's default resources' font of this name, or null */
function drFont(doc: PdfDocument, fontName: string): { ref: PdfObj; dict: PdfDict } | null {
  const form = acroForm(doc)
  const dr = form && doc.resolve(form.get('DR'))
  const fonts = isDict(dr) ? doc.resolve(dr.get('Font')) : null
  if (!isDict(fonts) || !fonts.has(fontName)) return null
  const d = doc.resolve(fonts.get(fontName))
  return isDict(d) ? { ref: fonts.get(fontName) ?? null, dict: d } : null
}

export function fontLook(doc: PdfDocument, e: Editing, name_: string, cache: Map<string, FontLook>): FontLook {
  const known = cache.get(name_)
  if (known) return known
  const found = drFont(doc, name_)
  const look = markFont(doc, name_, found, () => e.add(new Map<string, PdfObj>([['Type', name('Font')], ['Subtype', name('Type1')], ['BaseFont', name('Helvetica')], ['Encoding', name('WinAnsiEncoding')]])))
  cache.set(name_, look)
  return look
}

const bbox = (r: [number, number, number, number]) => [r[2] - r[0], r[3] - r[1]] as const

/** the picture of a text or choice widget showing `text` (not yet stored anywhere); null when the widget has no rectangle */
export function textPicture(doc: PdfDocument, e: Editing, t: Terminal, w: Widget, kind: FieldKind, text: string, fonts: Map<string, FontLook>): PdfStream | null {
  const rect = rectOf(doc, w)
  if (!rect) return null
  const look = widgetLook(doc, t, w, kind)
  const [width, height] = bbox(rect)
  const font = fontLook(doc, e, look.fontName, fonts)
  try {
    return textAppearance(width, height, text, look, font)
  } catch (err) {
    if (err instanceof PdfRangeError) throw new PdfRangeError(`The field "${t.name}" can't show "${text.slice(0, 20)}": it has a character this form's font does not have.`)
    throw err
  }
}

/** what a text or choice field shows: the typed text, or for a choice the label of the entry chosen */
export function shownText(doc: PdfDocument, t: Terminal, kind: FieldKind, given?: string): string {
  const v = t.attr('V')
  const value = given ?? textOf(doc, Array.isArray(v) ? v[0] : v)
  return kind === 'choice' ? (options(doc, t, kind).find((o) => o.value === value)?.label ?? value) : value
}

/** an appearance for a text or choice widget showing `text` */
function writeTextAppearance(doc: PdfDocument, e: Editing, t: Terminal, w: Widget, kind: FieldKind, text: string, fonts: Map<string, FontLook>) {
  if (!w.ref) return
  const stream = textPicture(doc, e, t, w, kind, text, fonts)
  if (stream) e.edit(w.ref).set('AP', new Map<string, PdfObj>([['N', e.add(stream)]]))
}

/** a widget's current on/off look exists already; make one if the file has none */
function ensureCheckAppearance(doc: PdfDocument, e: Editing, t: Terminal, w: Widget, kind: 'checkbox' | 'radio', on: string) {
  const rect = rectOf(doc, w)
  if (!rect || !w.ref || onStates(doc, w).length) return
  const look = widgetLook(doc, t, w, kind)
  const [width, height] = bbox(rect)
  const yes = e.add(checkAppearance(width, height, look, kind, true))
  const off = e.add(checkAppearance(width, height, look, kind, false))
  e.edit(w.ref).set('AP', new Map<string, PdfObj>([['N', new Map<string, PdfObj>([[on, yes], ['Off', off]])]]))
}

/** the widgets of a field have an appearance for every state a viewer may ask for */
function normalise(v: string | boolean | undefined, kind: FieldKind): string | boolean | undefined {
  if (v === undefined) return undefined
  if (kind === 'checkbox') return v === true || v === 'true' || v === 'on' || v === 'Yes'
  return typeof v === 'boolean' ? (v ? 'Yes' : '') : v
}

/**
 * Fill in fields by their full names, and give every text and choice field a visible appearance, so any viewer shows
 * what was typed. Characters the form's font lacks (it must be a Latin one) are refused with a message naming the field.
 */
export async function fillForm(doc: PdfDocument, values: FormValues): Promise<Uint8Array> {
  const terminals = terminalFields(doc)
  const byName = new Map(terminals.map((t) => [t.name, t]))
  for (const n of Object.keys(values)) if (!byName.has(n)) throw new PdfRangeError(`This form has no field named "${n}".`)
  return editDocument(doc, (e) => {
    const form = acroForm(doc)
    const needAll = !!form && doc.resolve(form.get('NeedAppearances')) === true
    const fonts = new Map<string, FontLook>()
    for (const t of terminals) {
      const kind = kindOf(t)
      const ff = num(t.attr('Ff'))
      const given = normalise(values[t.name], kind)
      const touched = given !== undefined
      if (touched && (ff & READ_ONLY)) throw new PdfRangeError(`The field "${t.name}" is read only.`)
      const field = t.ref ? e.edit(t.ref) : null
      if (kind === 'text' || kind === 'choice') {
        if (touched && field) field.set('V', encodeTextString(String(given)))
        const text = shownText(doc, t, kind, touched ? String(given) : undefined)
        // untouched fields are redrawn only when the file asked viewers to (or never had a picture)
        const hasPicture = t.widgets.some((w) => isDict(doc.resolve(w.dict.get('AP'))))
        if (touched || needAll || (!hasPicture && text)) for (const w of t.widgets) writeTextAppearance(doc, e, t, w, kind, text, fonts)
      } else if (touched && (kind === 'checkbox' || kind === 'radio')) {
        const states = t.widgets.map((w) => onStates(doc, w)[0])
        if (kind === 'checkbox') {
          const on = states[0] ?? 'Yes'
          t.widgets.forEach((w) => ensureCheckAppearance(doc, e, t, w, 'checkbox', on))
          const value = given === true
          field?.set('V', name(value ? on : 'Off'))
          for (const w of t.widgets) if (w.ref) e.edit(w.ref).set('AS', name(value ? on : 'Off'))
        } else {
          const chosen = String(given)
          if (chosen && !states.includes(chosen)) throw new PdfRangeError(`"${chosen}" is not one of the choices of "${t.name}".`)
          t.widgets.forEach((w, i) => ensureCheckAppearance(doc, e, t, w, 'radio', states[i] ?? 'Yes'))
          field?.set('V', name(chosen || 'Off'))
          t.widgets.forEach((w, i) => w.ref && e.edit(w.ref).set('AS', name(chosen && states[i] === chosen ? chosen : 'Off')))
        }
      }
    }
    // every field now has a picture, so viewers needn't redraw them
    if (form) {
      const r = doc.catalog().get('AcroForm')
      if (r instanceof PdfRef) e.edit(r).delete('NeedAppearances')
      else {
        const copy = new Map(form)
        copy.delete('NeedAppearances')
        e.catalog.set('AcroForm', copy)
      }
    }
  })
}
