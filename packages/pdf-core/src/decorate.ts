// Adding to existing pages without touching what they have: a drawing made with `buildPdf` (one page of it per page
// here) is placed over a page as a form, and markup, notes and links are added as annotations. Written through
// `editDocument`, so bookmarks, forms, links and metadata are kept.
import { PdfRef, PdfStream, PdfString, isDict, name, type PdfDict, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'
import { decodeStream } from './filters.ts'
import { deflate } from './flate.ts'
import { ascii } from './bytes.ts'
import { encodeTextString, pdfDate } from './info.ts'
import { editDocument, type Editing } from './rewrite.ts'
import { displayedToUser } from './edit.ts'

/** a point in displayed coordinates: points from the bottom left of the page as it is shown (rotation applied) */
export type Point = [number, number]
/** the four corners of a run of text: upper left, upper right, lower left, lower right */
export type Quad = [Point, Point, Point, Point]
/** red, green, blue, each 0..1 */
export type Colour = [number, number, number]

export type Annotation =
  | { kind: 'highlight' | 'underline' | 'strike'; quads: Quad[]; colour: Colour; text?: string }
  | { kind: 'note'; at: Point; text: string; colour: Colour }
  | { kind: 'link'; rect: [number, number, number, number]; uri?: string; page?: number }

export type PageAdditions = {
  /** a page of a PDF made by `buildPdf`, as big as this page is displayed, drawn over it */
  overlay?: { doc: PdfDocument; page: number }
  annots?: Annotation[]
}

const f = (v: number) => String(+v.toFixed(3))
const NOTE = 20 // points: a note's icon

/** copy objects of another document into this one (each object once, however often it is referred to) */
function copier(src: PdfDocument, e: Editing) {
  const done = new Map<number, PdfRef>()
  const copy = (o: PdfObj): PdfObj => {
    if (o instanceof PdfRef) {
      let ref = done.get(o.num)
      if (!ref) {
        ref = e.reserve()
        done.set(o.num, ref)
        e.set(ref, copy(src.resolve(o)))
      }
      return ref
    }
    if (o instanceof PdfStream) return new PdfStream(new Map([...o.dict].map(([k, v]) => [k, copy(v)])), o.data)
    if (Array.isArray(o)) return o.map(copy)
    if (isDict(o)) return new Map([...o].map(([k, v]) => [k, copy(v)]))
    return o
  }
  return copy
}

/** the page's resources as a dictionary of its own that can be changed */
function ownResources(doc: PdfDocument, page: { dict: PdfDict; inherited: PdfDict }): PdfDict {
  const r = doc.resolve(page.dict.get('Resources') ?? page.inherited.get('Resources'))
  return new Map(isDict(r) ? r : [])
}

/** draw on pages and add annotations to them; pages not in `additions` are left alone */
export async function decorate(doc: PdfDocument, additions: Map<number, PageAdditions>): Promise<Uint8Array> {
  const pages = doc.pages()
  // the drawings' contents, decoded ahead (editDocument's change runs with them at hand)
  const bodies = new Map<number, Uint8Array>()
  for (const [index, add] of additions) {
    if (!add.overlay) continue
    const p = add.overlay.doc.pages()[add.overlay.page]
    const parts: Uint8Array[] = []
    for (const c of [add.overlay.doc.resolve(p.dict.get('Contents'))].flat().map((x) => add.overlay!.doc.resolve(x))) if (c instanceof PdfStream) parts.push(await decodeStream(c))
    const joined = new Uint8Array(parts.reduce((n, b) => n + b.length + 1, 0))
    parts.reduce((at, b) => (joined.set(b, at), (joined[at + b.length] = 10), at + b.length + 1), 0)
    bodies.set(index, await deflate(joined))
  }
  const opened = ascii('q\n')
  return editDocument(doc, (e) => {
    const copiers = new Map<PdfDocument, (o: PdfObj) => PdfObj>()
    for (const [index, add] of additions) {
      const page = pages[index]
      const ref = e.pageRefs[index]
      if (!page || !ref) continue
      const { box, rotate } = doc.pageBox(page)
      const m = displayedToUser(box, rotate)
      const user = ([x, y]: Point): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
      const dict = e.edit(ref)

      if (add.overlay) {
        const src = add.overlay.doc
        let copy = copiers.get(src)
        if (!copy) copiers.set(src, (copy = copier(src, e)))
        const sp = src.pages()[add.overlay.page]
        const [w, h] = rotate % 180 === 90 ? [box[3] - box[1], box[2] - box[0]] : [box[2] - box[0], box[3] - box[1]]
        const res = ownResources(src, sp)
        const form = e.add(
          new PdfStream(
            new Map<string, PdfObj>([
              ['Type', name('XObject')],
              ['Subtype', name('Form')],
              ['BBox', [0, 0, w, h]],
              ['Matrix', m],
              ['Resources', copy(res)],
              ['Filter', name('FlateDecode')],
            ]),
            bodies.get(index)!,
          ),
        )
        const resources = ownResources(doc, page)
        const xo = doc.resolve(resources.get('XObject'))
        const xobjects: PdfDict = new Map(isDict(xo) ? xo : [])
        let n = 0
        while (xobjects.has(`ReamEdit${n}`)) n++
        xobjects.set(`ReamEdit${n}`, form)
        resources.set('XObject', xobjects)
        dict.set('Resources', resources)
        // the page's own content in a q/Q pair, so whatever state it leaves behind can't move the drawing
        const raw = page.dict.get('Contents')
        const own = doc.resolve(raw)
        const list = Array.isArray(own) ? own : raw ? [raw] : []
        dict.set('Contents', [e.add(new PdfStream(new Map(), opened)), ...list, e.add(new PdfStream(new Map(), ascii(`Q\n/ReamEdit${n} Do\n`)))])
      }

      if (add.annots?.length) {
        const existing = doc.resolve(page.dict.get('Annots'))
        const annots: PdfObj[] = Array.isArray(existing) ? [...existing] : []
        for (const a of add.annots) annots.push(...annotation(e, a, user, ref, e.pageRefs))
        dict.set('Annots', annots)
      }
    }
  })
}

const bounds = (pts: Point[]): [number, number, number, number] => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]

/** an appearance stream over `rect` (user space) drawn in user space coordinates */
function appearance(e: Editing, rect: number[], body: string, resources: PdfDict = new Map()): PdfRef {
  return e.add(new PdfStream(new Map<string, PdfObj>([['Type', name('XObject')], ['Subtype', name('Form')], ['BBox', rect], ['Resources', resources]]), ascii(body)))
}

/** the annotation objects for one addition (a note brings its pop-up with it) */
function annotation(e: Editing, a: Annotation, user: (p: Point) => Point, page: PdfRef, pageRefs: (PdfRef | null)[]): PdfRef[] {
  const common: [string, PdfObj][] = [['Type', name('Annot')], ['P', page], ['M', new PdfString(ascii(pdfDate()))]]
  if (a.kind === 'link') {
    const [x0, y0, x1, y1] = a.rect
    const rect = bounds([user([x0, y0]), user([x1, y1])])
    const target = a.page !== undefined ? pageRefs[a.page] : null
    const action: PdfObj = a.uri ? new Map<string, PdfObj>([['S', name('URI')], ['URI', new PdfString(ascii(a.uri))]]) : new Map<string, PdfObj>([['S', name('GoTo')], ['D', [target ?? null, name('Fit')]]])
    return [e.add(new Map<string, PdfObj>([...common, ['Subtype', name('Link')], ['Rect', rect], ['Border', [0, 0, 0]], ['A', action]]))]
  }
  const c = a.colour.map((v) => +v.toFixed(3))
  if (a.kind === 'note') {
    const [x, y] = user(a.at)
    const rect = [x, y - NOTE, x + NOTE, y]
    // a speech bubble in the note's colour, so viewers that draw only appearances show it too
    const icon = `${c.join(' ')} rg 0 G 0.5 w ${f(x + 1)} ${f(y - 15)} 18 14 re B ${f(x + 4)} ${f(y - 15)} m ${f(x + 4)} ${f(y - 19)} l ${f(x + 8)} ${f(y - 15)} l b 0 G ${f(x + 4)} ${f(y - 6)} m ${f(x + 16)} ${f(y - 6)} l ${f(x + 4)} ${f(y - 9)} m ${f(x + 16)} ${f(y - 9)} l ${f(x + 4)} ${f(y - 12)} m ${f(x + 12)} ${f(y - 12)} l S`
    const note = e.reserve()
    const popup = e.add(new Map<string, PdfObj>([['Type', name('Annot')], ['Subtype', name('Popup')], ['P', page], ['Parent', note], ['Rect', [x + NOTE, y - 120, x + NOTE + 180, y]], ['Open', false]]))
    e.set(note, new Map<string, PdfObj>([...common, ['Subtype', name('Text')], ['Rect', rect], ['Contents', encodeTextString(a.text)], ['Name', name('Comment')], ['C', c], ['F', 28], ['Popup', popup], ['AP', new Map([['N', appearance(e, rect, icon)]])]]))
    return [note, popup]
  }
  // markup over text: QuadPoints in the order viewers expect (upper left, upper right, lower left, lower right)
  const quads = a.quads.map((q) => q.map(user) as Quad)
  const rect = bounds(quads.flat())
  const qp = quads.flatMap((q) => q.flatMap((p) => p.map((v) => +v.toFixed(3))))
  const along = (p: Point, q: Point, t: number): Point => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
  let body: string
  const res = new Map<string, PdfObj>()
  if (a.kind === 'highlight') {
    res.set('ExtGState', new Map([['M', new Map<string, PdfObj>([['Type', name('ExtGState')], ['BM', name('Multiply')]])]]))
    body = `/M gs ${c.join(' ')} rg ` + quads.map(([ul, ur, ll, lr]) => `${f(ul[0])} ${f(ul[1])} m ${f(ur[0])} ${f(ur[1])} l ${f(lr[0])} ${f(lr[1])} l ${f(ll[0])} ${f(ll[1])} l h f`).join(' ')
  } else {
    const t = a.kind === 'underline' ? 0.92 : 0.55 // how far down the line goes, from the top of the run
    body = `${c.join(' ')} RG ` + quads.map(([ul, ur, ll, lr]) => {
      const h = Math.hypot(ll[0] - ul[0], ll[1] - ul[1])
      const p = along(ul, ll, t)
      const q = along(ur, lr, t)
      return `${f(Math.max(0.5, h / 14))} w ${f(p[0])} ${f(p[1])} m ${f(q[0])} ${f(q[1])} l S`
    }).join(' ')
  }
  const subtype = a.kind === 'highlight' ? 'Highlight' : a.kind === 'underline' ? 'Underline' : 'StrikeOut'
  return [e.add(new Map<string, PdfObj>([...common, ['Subtype', name(subtype)], ['Rect', rect], ['QuadPoints', qp], ['C', c], ['F', 4], ...(a.text ? ([['Contents', encodeTextString(a.text)]] as [string, PdfObj][]) : []), ['AP', new Map([['N', appearance(e, rect, body, res)]])]]))]
}
