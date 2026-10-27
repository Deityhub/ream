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
  /** every place the field is shown (a radio button each, or a field repeated on several pages) */
  widgets: FieldWidget[]
  /** a choice that also takes text of one's own */
  editable: boolean
  /** the form says people can't fill it in with these tools (several choices at once, files, ...) */
  unsupported: boolean
  /** the help text viewers show for it (/TU) */
  tooltip: string
  required: boolean
  /** 0 left, 1 centre, 2 right */
  align: number
  /** points; 0 means as big as fits */
  fontSize: number
  textColour: [number, number, number]
  /** from the first widget: its border and background (null for none) */
  border: [number, number, number] | null
  borderWidth: number
  background: [number, number, number] | null
  /** a text field that a viewer formats as a date (Acrobat's AFDate_FormatEx), with its format */
  dateFormat: string | null
}

/** one place a field is shown: its page and its box as fractions of the page as displayed (rotation applied, y from the top) */
export type FieldWidget = {
  page: number | null
  box: { x: number; y: number; w: number; h: number } | null
  /** radio buttons and checkboxes: the value this widget stands for */
  state: string | null
}

export type FormInfo = {
  fields: FormField[]
  /** the file has an XFA form (a different, XML based kind) that these tools can't fill */
  xfa: boolean
}

// field flags
export const READ_ONLY = 1 << 0
export const REQUIRED = 1 << 1
export const MULTILINE = 1 << 12
export const PASSWORD = 1 << 13
export const RADIO = 1 << 15
export const PUSH = 1 << 16
export const COMBO = 1 << 17
export const EDIT = 1 << 18
const MULTI_SELECT = 1 << 21
const FILE_SELECT = 1 << 20
export const COMB = 1 << 24
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
  /** the field the form lists in its place, when the pages show this copy instead (see `terminalFields`) */
  replaces?: PdfRef
  /** for a field taken from the pages: the topmost field above it, which the form's list should name */
  top?: PdfRef
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
  adoptPageWidgets(doc, form, out)
  return out
}

/**
 * Some files list one copy of each field in the form and show another on the pages (an editor rewrote one and not the
 * other). Viewers show and fill the page's widgets, so a field whose widgets are on no page takes the page widgets of
 * the same name, and page widgets with a name the form lacks become fields of their own.
 */
function adoptPageWidgets(doc: PdfDocument, form: PdfDict | null, out: Terminal[]) {
  const known = new Set<PdfDict>()
  for (const t of out) for (const w of t.widgets) known.add(w.dict)
  const shown = new Set<PdfDict>()
  const orphans: { ref: PdfRef | null; dict: PdfDict }[] = []
  for (const p of doc.pages()) {
    const annots = doc.resolve(p.dict.get('Annots'))
    for (const a of Array.isArray(annots) ? annots : []) {
      const d = doc.resolve(a)
      if (!isDict(d) || !isName(doc.resolve(d.get('Subtype')), 'Widget')) continue
      shown.add(d)
      if (!known.has(d)) orphans.push({ ref: a instanceof PdfRef ? a : null, dict: d })
    }
  }
  if (!orphans.length) return
  // the chain of groups above a widget, top first, by /Parent
  const chainOf = (d: PdfDict): PdfDict[] => {
    const chain = [d]
    for (let p = doc.resolve(d.get('Parent')); isDict(p) && chain.length < 32 && !chain.includes(p); p = doc.resolve(p.get('Parent'))) chain.unshift(p)
    return chain
  }
  const byName = new Map(out.map((t) => [t.name, t]))
  for (const o of orphans) {
    const chain = chainOf(o.dict)
    // a widget without a name of its own belongs to the field above it
    const fieldChain = o.dict.has('T') ? chain : chain.slice(0, -1)
    const name_ = fieldChain.map((d) => textOf(doc, d.get('T'))).filter(Boolean).join('.')
    if (!name_) continue
    const fieldDict = fieldChain[fieldChain.length - 1]
    const fieldRef = o.dict.has('T') ? o.ref : ((o.dict.get('Parent') instanceof PdfRef ? o.dict.get('Parent') : null) as PdfRef | null)
    const attr: Terminal['attr'] = (key) => {
      for (let i = fieldChain.length - 1; i >= 0; i--) if (fieldChain[i].has(key)) return doc.resolve(fieldChain[i].get(key))
      return doc.resolve(key === 'DA' || key === 'Q' ? form?.get(key) : undefined)
    }
    // the topmost field above the widget, which the form's list should name
    let top: PdfRef | null = o.ref
    for (let d: PdfObj = o.dict, i = 0; isDict(d) && d.get('Parent') instanceof PdfRef && i < 32; i++) {
      top = d.get('Parent') as PdfRef
      d = doc.resolve(top)
    }
    const listed = byName.get(name_)
    if (listed && !listed.widgets.some((w) => shown.has(w.dict))) {
      // the form's copy is shown nowhere: the page's copy takes its place
      const t: Terminal = { ...listed, ref: fieldRef, dict: fieldDict, widgets: [o], attr, replaces: listed.ref ?? undefined, top: top ?? undefined }
      out[out.indexOf(listed)] = t
      byName.set(name_, t)
    } else if (listed && listed.dict === fieldDict) listed.widgets.push(o) // another widget of a field taken from the page
    else if (!listed) {
      const t: Terminal = { name: name_, ref: fieldRef, dict: fieldDict, widgets: [o], attr, top: top ?? undefined }
      out.push(t)
      byName.set(name_, t)
    }
    // ponytail: a page widget whose name the form uses for a field shown elsewhere is left out; merge them if files need it
  }
}

export const num = (v: PdfObj) => (typeof v === 'number' ? v : 0)

export function kindOf(doc: PdfDocument, t: Terminal): FieldKind {
  const ft = t.attr('FT')
  const ff = num(t.attr('Ff'))
  if (isName(ft, 'Tx')) return 'text'
  if (isName(ft, 'Ch')) return 'choice'
  if (isName(ft, 'Sig')) return 'signature'
  if (!isName(ft, 'Btn')) return 'text'
  if (ff & PUSH) return 'button'
  if (ff & RADIO) return 'radio'
  // buttons of one field that stand for different values are a radio group, whatever the flag says: viewers
  // (Acrobat among them) treat them so, and some editors drop the flag when they save
  const states = new Set(t.widgets.map((w) => onStates(doc, w)[0]).filter(Boolean))
  return states.size > 1 ? 'radio' : 'checkbox'
}

/** the names of the appearance states a widget has, besides Off */
export function onStates(doc: PdfDocument, w: Widget): string[] {
  const ap = doc.resolve(w.dict.get('AP'))
  const n = isDict(ap) ? doc.resolve(ap.get('N')) : null
  return isDict(n) ? [...n.keys()].filter((k) => k !== 'Off') : []
}

export const rectOf = (doc: PdfDocument, w: Widget): [number, number, number, number] | null => {
  const r = doc.resolve(w.dict.get('Rect'))
  const n = Array.isArray(r) ? r.map((v) => doc.resolve(v)) : []
  if (n.length !== 4 || !n.every((v) => typeof v === 'number')) return null
  const [a, b, c, d] = n as number[]
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]
}

export function options(doc: PdfDocument, t: Terminal, kind: FieldKind): { value: string; label: string }[] {
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

/** a rectangle in page user space as fractions of the page as displayed (rotation applied, y from the top) */
function displayedBox(doc: PdfDocument, page: number, r: [number, number, number, number]): FieldWidget['box'] {
  const { box, rotate } = doc.pageBox(doc.pages()[page])
  const [w, h] = [box[2] - box[0], box[3] - box[1]]
  if (w <= 0 || h <= 0) return null
  // user space -> displayed points from the top left, as the renderer turns pages
  const at = (x: number, y: number): [number, number] => {
    const [u, v] = [x - box[0], y - box[1]]
    return rotate === 90 ? [v, u] : rotate === 180 ? [w - u, v] : rotate === 270 ? [h - v, w - u] : [u, h - v]
  }
  const [W, H] = rotate % 180 === 90 ? [h, w] : [w, h]
  const [a, b] = [at(r[0], r[1]), at(r[2], r[3])]
  return { x: Math.min(a[0], b[0]) / W, y: Math.min(a[1], b[1]) / H, w: Math.abs(a[0] - b[0]) / W, h: Math.abs(a[1] - b[1]) / H }
}

/** the form's fields as plain data, for a panel to show */
export function readForm(doc: PdfDocument): FormInfo {
  const form = acroForm(doc)
  const xfa = !!form && form.has('XFA')
  const pageOf = new Map<number, number>()
  const pageOfDict = new Map<PdfDict, number>()
  const pages = doc.pages()
  pages.forEach((p, i) => {
    const annots = doc.resolve(p.dict.get('Annots'))
    if (!Array.isArray(annots)) return
    for (const a of annots) {
      if (a instanceof PdfRef && !pageOf.has(a.num)) pageOf.set(a.num, i)
      const d = doc.resolve(a)
      if (isDict(d) && !pageOfDict.has(d)) pageOfDict.set(d, i)
    }
  })
  const widgetPage = (w: Widget) => (w.ref ? pageOf.get(w.ref.num) : undefined) ?? pageOfDict.get(w.dict) ?? null
  const fields = terminalFields(doc).map((t): FormField => {
    const kind = kindOf(doc, t)
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
    const da = parseDefaultAppearance(textOf(doc, t.attr('DA')) || '/Helv 0 Tf 0 g')
    const mk = first ? doc.resolve(first.dict.get('MK')) : null
    const bs = first ? doc.resolve(first.dict.get('BS')) : null
    const q = t.attr('Q')
    const page = first ? widgetPage(first) : t.ref ? (pageOf.get(t.ref.num) ?? null) : null
    const widgets = t.widgets.map((w): FieldWidget => {
      const p = widgetPage(w)
      const r = rectOf(doc, w)
      return { page: p, box: p !== null && r ? displayedBox(doc, p, r) : null, state: kind === 'radio' || kind === 'checkbox' ? (onStates(doc, w)[0] ?? null) : null }
    })
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
      widgets,
      editable: kind === 'choice' && !!(ff & EDIT),
      unsupported: kind === 'signature' || kind === 'button' || !!(ff & (MULTI_SELECT | FILE_SELECT | RICH)) || (kind === 'checkbox' && !first),
      tooltip: textOf(doc, t.dict.get('TU')),
      required: !!(ff & REQUIRED),
      align: typeof q === 'number' ? Math.min(2, Math.max(0, q)) : 0,
      fontSize: da.size,
      textColour: rgbOf(da.colour.split(/\s+/).slice(0, -1).map(Number)) ?? [0, 0, 0],
      border: isDict(mk) ? colourArray(doc, mk.get('BC')) : null,
      borderWidth: isDict(bs) && typeof doc.resolve(bs.get('W')) === 'number' ? (doc.resolve(bs.get('W')) as number) : 1,
      background: isDict(mk) ? colourArray(doc, mk.get('BG')) : null,
      dateFormat: kind === 'text' ? dateFormatOf(doc, t) : null,
    }
  })
  return { fields, xfa }
}

/** grey, RGB or CMYK parts as RGB */
const rgbOf = (n: number[]): [number, number, number] | null =>
  n.some((v) => !Number.isFinite(v)) ? null : n.length === 1 ? [n[0], n[0], n[0]] : n.length === 3 ? [n[0], n[1], n[2]] : n.length === 4 ? [0, 1, 2].map((i) => (1 - n[i]) * (1 - n[3])) as [number, number, number] : null

const colourArray = (doc: PdfDocument, o: PdfObj | undefined) => {
  const a = doc.resolve(o)
  return Array.isArray(a) ? rgbOf(a.map((v) => doc.resolve(v)).map((v) => (typeof v === 'number' ? v : NaN))) : null
}

/** the date format a field's format script asks for, as Acrobat writes it: AFDate_FormatEx("dd/mm/yyyy") */
export function dateFormatOf(doc: PdfDocument, t: Terminal): string | null {
  const aa = doc.resolve(t.dict.get('AA'))
  const f = isDict(aa) ? doc.resolve(aa.get('F')) : null
  const js = isDict(f) ? doc.resolve(f.get('JS')) : null
  const text = js instanceof PdfString ? decodeTextString(js.bytes) : js instanceof PdfStream && !js.dict.has('Filter') ? String.fromCharCode(...js.data) : ''
  return /AFDate_Format(?:Ex)?\(\s*"([^"]+)"/.exec(text)?.[1] ?? null
}

/** the form dictionary as a private copy that may be changed (made when the file has none) */
export function editableForm(e: Editing): PdfDict {
  const r = e.catalog.get('AcroForm')
  if (r instanceof PdfRef) return e.edit(r)
  const form: PdfDict = new Map(isDict(r) ? r : [['Fields', []]])
  e.catalog.set('AcroForm', form)
  return form
}

/** take the removed widgets (by object number) out of the form, and the fields left without any widget with them */
export function pruneFields(doc: PdfDocument, e: Editing, gone: Set<number>) {
  if (!e.catalog.get('AcroForm')) return
  const form = editableForm(e)
  /** a field (or widget) still has something on a page */
  const alive = (ref: PdfObj, depth = 0): boolean => {
    if (ref instanceof PdfRef && gone.has(ref.num)) return false
    const d = doc.resolve(ref)
    if (!isDict(d) || depth > 32) return true
    const kids = doc.resolve(d.get('Kids'))
    if (!Array.isArray(kids)) return true
    const left = kids.filter((k) => alive(k, depth + 1))
    if (left.length !== kids.length && ref instanceof PdfRef) {
      if (!left.length) return false
      e.edit(ref).set('Kids', left)
    }
    return left.length > 0
  }
  const fields = doc.resolve(form.get('Fields'))
  if (Array.isArray(fields)) form.set('Fields', fields.filter((f) => alive(f)))
}

/** the form lists the copies of fields that the pages show (see `adoptPageWidgets`) */
export function listShownFields(doc: PdfDocument, e: Editing, terminals: Terminal[]) {
  const swap = new Map<number, PdfRef>()
  const extra: PdfRef[] = []
  for (const t of terminals) {
    if (t.replaces && t.top) swap.set(t.replaces.num, t.top)
    else if (t.top && !t.replaces) extra.push(t.top)
  }
  if (!swap.size && !extra.length) return
  const form = editableForm(e)
  const listed = doc.resolve(form.get('Fields'))
  const fields = (Array.isArray(listed) ? listed : []).map((f) => (f instanceof PdfRef && swap.has(f.num) ? swap.get(f.num)! : f))
  for (const x of extra) if (!fields.some((f) => f instanceof PdfRef && f.num === x.num)) fields.push(x)
  form.set('Fields', fields)
}

// ---------- filling ----------

export type FormValues = Record<string, string | boolean>

/** `/Helv 12 Tf 0 g` -> the font's resource name, its size (0 = fit the box) and the colour operators */
export function parseDefaultAppearance(da: string): { font: string; size: number; colour: string } {
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
      const kind = kindOf(doc, t)
      const ff = num(t.attr('Ff'))
      const given = normalise(values[t.name], kind)
      const touched = given !== undefined
      if (touched && (ff & READ_ONLY)) throw new PdfRangeError(`The field "${t.name}" is read only.`)
      const field = t.ref ? e.edit(t.ref) : null
      if (kind === 'text' || kind === 'choice') {
        if (touched) {
          const text = String(given)
          const max = t.attr('MaxLen')
          if (kind === 'text' && typeof max === 'number' && max > 0 && [...text].length > max) throw new PdfRangeError(`The field "${t.name}" takes at most ${max} characters.`)
          if (kind === 'choice' && text && !(ff & EDIT) && !options(doc, t, kind).some((o) => o.value === text)) throw new PdfRangeError(`"${text}" is not one of the choices of "${t.name}".`)
        }
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
    // every field now has a picture, so viewers needn't redraw them; and the form lists the copies the pages show
    if (form) {
      editableForm(e).delete('NeedAppearances')
      listShownFields(doc, e, terminals)
    }
  })
}
