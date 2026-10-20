// Redaction: what lies under the areas is taken out of the file, not just covered. Letters are removed one by one (the
// text after them keeps its place), shapes are cut at the areas' edges, the pixels of pictures under them are wiped,
// forms that reach into an area are redacted as private copies, and annotations over an area go. A black box is drawn
// over each area. The file is written again from scratch, so nothing of the old content is left in it.
import {
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  decodeStream,
  decodeUntilImage,
  deflate,
  editDocument,
  isDict,
  isName,
  scanContent,
  usedResources,
  type Editing,
  type PdfDict,
  type PdfDocument,
  type PdfObj,
} from '@ream/pdf-core'
import { BoundsCtx, pageContent, type Box } from './bounds.ts'
import { loadColorSpace } from './color.ts'
import { numbers } from './function.ts'
import { rasterizeImage } from './image.ts'
import { Interpreter, type OpInfo, type ShownGlyph } from './interpreter.ts'
import { IDENTITY, apply, invert, mul, pageMatrix, scaleOf, type Matrix } from './matrix.ts'
import type { Ctx2D, Platform } from './platform.ts'
import { cutFill, cutStroke, flattenPath, overlaps, pathOps, touches, type Pt } from './redact-paths.ts'

const MAX_DEPTH = 8
const CONSTRUCT = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're'])
const FILLS = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*'])
const STROKES = new Set(['S', 's', 'B', 'B*', 'b', 'b*'])
const TEXT = new Set(['Tj', 'TJ', "'", '"'])

export type RedactOptions = {
  /** pictures in a JPEG (DCT) are decoded through the platform to be wiped */
  platform: Platform
  /** also remove the document information, XMP metadata, page thumbnails and private application data */
  hidden: boolean
}

type Op = OpInfo & { bbox: Box | null; glyphs: ShownGlyph[]; image: { stream: PdfStream; ctm: Matrix } | null }

const boxQuad = ([x1, y1, x2, y2]: Box): Pt[] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
const meets = (a: Box, b: Box) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
const f4 = (v: number) => String(+v.toFixed(4))
const hex = (b: Uint8Array) => '<' + Array.from(b, (c) => c.toString(16).padStart(2, '0')).join('') + '>'

/** inline image keys and colour spaces in their long forms, so the picture can become an image object */
const LONG: Record<string, string> = { W: 'Width', H: 'Height', BPC: 'BitsPerComponent', CS: 'ColorSpace', D: 'Decode', DP: 'DecodeParms', F: 'Filter', IM: 'ImageMask', I: 'Interpolate' }
const LONG_CS: Record<string, string> = { G: 'DeviceGray', RGB: 'DeviceRGB', CMYK: 'DeviceCMYK', I: 'Indexed' }

class Redactor {
  doc: PdfDocument
  e: Editing
  areas: Box[]
  platform: Platform
  count = 0
  constructor(doc: PdfDocument, e: Editing, areas: Box[], platform: Platform) {
    this.doc = doc
    this.e = e
    this.areas = areas
    this.platform = platform
  }

  /** every top-level operator of a stream, with what it paints, the glyphs it shows and the picture it draws */
  private async analyse(content: Uint8Array, res: PdfDict, ctm: Matrix): Promise<Op[]> {
    const ctx = new BoundsCtx()
    const interp = new Interpreter(this.doc, ctx as unknown as Ctx2D, NO_PLATFORM, IDENTITY)
    interp.analysis = true
    interp.reset(ctm)
    const ops: Op[] = []
    let glyphs: ShownGlyph[] = []
    let image: Op['image'] = null
    interp.onShow = (g) => glyphs.push(g)
    interp.onImage = (stream, m) => {
      if (interp.depth === interp.recordDepth) image = { stream, ctm: m }
    }
    interp.onOp = (info) => {
      ops.push({ ...info, bbox: ctx.take(), glyphs, image })
      glyphs = []
      image = null
    }
    await interp.run(content, res, true)
    return ops
  }

  private hits(quad: Pt[]): boolean {
    return this.areas.some((a) => overlaps(quad, boxQuad(a)))
  }

  /**
   * The stream without what is under the areas. `ctm` maps the stream's space to page user space. The result's
   * resources are `res` with the new pictures and forms added (a new dictionary only when something was added).
   */
  async stream(content: Uint8Array, res: PdfDict, ctm: Matrix, depth: number): Promise<{ content: Uint8Array; res: PdfDict; changed: boolean }> {
    const ops = await this.analyse(content, res, ctm)
    const edits: { start: number; end: number; text: string }[] = []
    const added = new Map<string, PdfRef>()
    const latin = (a: number, b: number) => Array.from(content.subarray(a, b), (c) => String.fromCharCode(c)).join('')

    let path: Op[] = []
    let clip: string | null = null
    for (const o of ops) {
      if (CONSTRUCT.has(o.op)) {
        path.push(o)
        continue
      }
      if (o.op === 'W' || o.op === 'W*') {
        clip = o.op
        continue
      }
      if (FILLS.has(o.op) || STROKES.has(o.op) || o.op === 'n') {
        const cut = o.op === 'n' || !path.length ? null : this.path(path, o, clip, latin)
        if (cut !== null) edits.push({ start: path[0].start, end: o.end, text: cut })
        path = []
        clip = null
        continue
      }
      if (TEXT.has(o.op) && o.glyphs.some((g) => this.hits(g.quad))) {
        edits.push({ start: o.start, end: o.end, text: this.text(o) })
        continue
      }
      if (o.op === 'BI' && o.image) {
        const done = await this.picture(o.image.stream, o.image.ctm, res, true)
        if (done === false) continue
        const name = this.name('RdIm')
        if (done) added.set(name, this.e.add(done))
        edits.push({ start: o.start, end: o.end, text: done ? `/${name} Do` : '' })
        continue
      }
      if (o.op === 'Do' && o.args[0] instanceof PdfName) {
        const x = this.lookup(res, 'XObject', o.args[0].value)
        if (!(x instanceof PdfStream)) continue
        let replacement: PdfStream | null | false = false
        if (isName(this.doc.resolve(x.dict.get('Subtype')), 'Image') && o.image) replacement = await this.picture(o.image.stream, o.image.ctm, res, false)
        else if (isName(this.doc.resolve(x.dict.get('Subtype')), 'Form') && o.bbox && this.areas.some((a) => meets(a, o.bbox!))) replacement = await this.form(x, res, o.ctm, depth)
        if (replacement === false) continue
        const name = this.name(replacement && isName(replacement.dict.get('Subtype'), 'Form') ? 'RdFm' : 'RdIm')
        if (replacement) added.set(name, this.e.add(replacement))
        edits.push({ start: o.start, end: o.end, text: replacement ? `/${name} Do` : '' })
      }
    }

    if (!edits.length) return { content, res, changed: false }
    const enc = new TextEncoder()
    const parts: Uint8Array[] = []
    let at = 0
    for (const ed of edits.sort((a, b) => a.start - b.start)) {
      parts.push(content.subarray(at, ed.start), enc.encode(ed.text + ' '))
      at = ed.end
    }
    parts.push(content.subarray(at))
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    parts.reduce((i, p) => (out.set(p, i), i + p.length), 0)
    // the pictures and forms the new content no longer names are dropped, or the originals would stay in the file
    const xo = this.doc.resolve(res.get('XObject'))
    const all = new Map<string, PdfObj>([...(isDict(xo) ? xo : []), ...added])
    const used = usedResources(scanContent(out)).names.XObject ?? new Set<string>()
    // a form without resources of its own draws with these: what it names can't be told, so everything stays
    const inherits = [...used].some((n) => {
      const x = this.doc.resolve(all.get(n))
      return x instanceof PdfStream && isName(this.doc.resolve(x.dict.get('Subtype')), 'Form') && !x.dict.has('Resources')
    })
    const nextRes = new Map(res)
    nextRes.set('XObject', inherits ? all : new Map([...all].filter(([n]) => used.has(n))))
    return { content: out, res: nextRes, changed: true }
  }

  private name(prefix: string) {
    return `${prefix}${++this.count}`
  }

  private lookup(res: PdfDict, kind: string, name: string): PdfObj {
    const table = this.doc.resolve(res.get(kind))
    return isDict(table) ? this.doc.resolve(table.get(name)) : null
  }

  /** a painted path that reaches into an area, cut at the areas' edges; null when nothing of it is under one */
  private path(construct: Op[], paint: Op, clip: string | null, latin: (a: number, b: number) => string): string | null {
    if (paint.bbox && !this.areas.some((a) => meets(a, paint.bbox!))) return null
    const ctm = construct[0].ctm
    const back = invert(ctm)
    const quads = this.areas.map((a) => boxQuad(a).map(([x, y]) => apply(back, x, y)))
    const subs = flattenPath(construct, scaleOf(ctm))
    // s, b and b* close the last subpath before painting
    if ((paint.op === 's' || paint.op === 'b' || paint.op === 'b*') && subs.length) subs[subs.length - 1].closed = true
    const fill = FILLS.has(paint.op)
    const stroke = STROKES.has(paint.op)
    if (!(fill && touches(subs, quads, true)) && !(stroke && touches(subs, quads, false))) return null
    const out: string[] = []
    // a clipping path keeps its own geometry: it draws nothing, and what it clips may lie outside the areas
    if (clip) out.push(`${latin(construct[0].start, construct[construct.length - 1].end)} ${clip} n`)
    const evenOdd = paint.op.endsWith('*')
    if (fill) {
      const polys = cutFill(subs, quads)
      if (polys.length) out.push(`${pathOps(polys.map((pts) => ({ pts, closed: true })))} ${evenOdd ? 'f*' : 'f'}`)
    }
    if (stroke) {
      const lines = cutStroke(subs, quads)
      if (lines.length) out.push(`${pathOps(lines)} S`)
    }
    return out.length ? out.join('\n') : 'n'
  }

  /** a text operator with the letters under the areas taken out; each becomes a move as long as it was */
  private text(o: Op): string {
    const strings: (PdfObj | undefined)[] = o.op === 'TJ' ? (Array.isArray(o.args[0]) ? o.args[0] : []) : [o.op === '"' ? o.args[2] : o.args[0]]
    const lead = o.op === "'" ? 'T* ' : o.op === '"' ? `${Number(o.args[0]) || 0} Tw ${Number(o.args[1]) || 0} Tc T* ` : ''
    const scale = o.fontSize * o.hScale
    const items: (Uint8Array | number)[] = []
    strings.forEach((item, i) => {
      if (typeof item === 'number') return void items.push(item)
      if (!(item instanceof PdfString)) return
      let from = 0
      for (const g of o.glyphs.filter((x) => x.item === i).sort((a, b) => a.offset - b.offset)) {
        if (!this.hits(g.quad)) continue
        if (g.offset > from) items.push(item.bytes.subarray(from, g.offset))
        // the TJ number that moves the text position as far as the removed letter did
        if (scale) items.push((-g.tx * 1000) / scale)
        from = g.offset + g.length
      }
      if (from < item.bytes.length) items.push(item.bytes.subarray(from))
    })
    const merged: (Uint8Array | number)[] = []
    for (const it of items) {
      const last = merged[merged.length - 1]
      if (typeof it === 'number' && typeof last === 'number') merged[merged.length - 1] = last + it
      else merged.push(it)
    }
    return `${lead}[${merged.map((it) => (typeof it === 'number' ? f4(it) : hex(it))).join(' ')}] TJ`
  }

  /**
   * A picture (an image object, or an inline image) with the pixels under the areas wiped, as a new image object;
   * false when no pixel of it is under an area, null when it can't be read (it is then removed).
   */
  private async picture(stream: PdfStream, ctm: Matrix, res: PdfDict, inline: boolean): Promise<PdfStream | null | false> {
    const corners: Pt[] = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 1, 1), apply(ctm, 0, 1)]
    if (!this.hits(corners)) return false
    const doc = this.doc
    const dict: PdfDict = new Map()
    for (const [k, v] of stream.dict) dict.set(inline ? (LONG[k] ?? k) : k, v)
    const cs = dict.get('ColorSpace')
    if (inline && cs instanceof PdfName) {
      // an inline image names device spaces in short, other spaces through the page's resources
      dict.set('ColorSpace', LONG_CS[cs.value] ? new PdfName(LONG_CS[cs.value]) : (this.lookup(res, 'ColorSpace', cs.value) ?? cs))
    } else if (inline && Array.isArray(cs)) {
      dict.set('ColorSpace', cs.map((c) => (c instanceof PdfName && LONG_CS[c.value] ? new PdfName(LONG_CS[c.value]) : c)))
    }
    const width = Number(doc.resolve(dict.get('Width'))) || 0
    const height = Number(doc.resolve(dict.get('Height'))) || 0
    if (width < 1 || height < 1) return null
    // which pixels are under an area: their centres, through the picture's matrix
    const back = invert(ctm)
    const covered = (wipe: (x: number, y: number) => void) => {
      for (const a of this.areas) {
        const us = boxQuad(a).map(([x, y]) => apply(back, x, y))
        const x0 = Math.max(0, Math.floor(Math.min(...us.map((u) => u[0])) * width))
        const x1 = Math.min(width - 1, Math.ceil(Math.max(...us.map((u) => u[0])) * width))
        const y0 = Math.max(0, Math.floor((1 - Math.max(...us.map((u) => u[1]))) * height))
        const y1 = Math.min(height - 1, Math.ceil((1 - Math.min(...us.map((u) => u[1]))) * height))
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const [px, py] = apply(ctm, (x + 0.5) / width, 1 - (y + 0.5) / height)
            if (px >= a[0] && px <= a[2] && py >= a[1] && py <= a[3]) wipe(x, y)
          }
        }
      }
    }
    let decoded
    try {
      decoded = await decodeUntilImage(new PdfStream(dict, stream.data))
    } catch {
      return null
    }
    const out = new Map(dict)
    for (const k of ['Filter', 'DecodeParms', 'Length']) out.delete(k)
    out.set('Type', new PdfName('XObject'))
    out.set('Subtype', new PdfName('Image'))
    out.set('Filter', new PdfName('FlateDecode'))
    if (decoded.rest) {
      // a JPEG: decoded, wiped and kept losslessly as RGB (its soft mask, if any, stays as it was)
      if (decoded.rest.filter !== 'DCTDecode' && decoded.rest.filter !== 'DCT') return null
      const raster = await rasterizeImage({ doc, platform: this.platform, resources: res, fill: [0, 0, 0], warn: () => {} }, new PdfStream(new Map([...dict].filter(([k]) => k !== 'SMask' && k !== 'Mask')), stream.data))
      if (raster === 'unsupported') return null
      const rgb = new Uint8Array(raster.width * raster.height * 3)
      for (let p = 0; p < raster.width * raster.height; p++) rgb.set(raster.rgba.subarray(p * 4, p * 4 + 3), p * 3)
      covered((x, y) => rgb.fill(0, (y * raster.width + x) * 3, (y * raster.width + x) * 3 + 3))
      for (const k of ['Decode', 'ColorSpace', 'BitsPerComponent']) out.delete(k)
      out.set('Width', raster.width)
      out.set('Height', raster.height)
      out.set('ColorSpace', new PdfName('DeviceRGB'))
      out.set('BitsPerComponent', 8)
      return new PdfStream(out, await deflate(rgb))
    }
    // raw samples: the pixels' bits are set in place, so colours, masks and the rest of the picture stay exactly as they were
    const mask = doc.resolve(dict.get('ImageMask')) === true
    const bpc = mask ? 1 : Number(doc.resolve(dict.get('BitsPerComponent'))) || 8
    const n = mask ? 1 : (await loadColorSpace(doc, dict.get('ColorSpace'), res)).n
    const row = Math.ceil((width * n * bpc) / 8)
    const data = new Uint8Array(row * height)
    data.set(decoded.data.subarray(0, data.length))
    // a stencil mask is left unpainted where it is wiped; anything else gets samples of 0
    const decode = numbers(doc, dict.get('Decode'))
    const unpainted = mask ? (decode && decode[0] === 1 ? 0 : 1) : 0
    covered((x, y) => {
      for (let c = 0; c < n; c++) {
        const bit = (x * n + c) * bpc
        for (let k = 0; k < bpc; k++) {
          const at = y * row + ((bit + k) >> 3)
          const m = 0x80 >> ((bit + k) & 7)
          data[at] = unpainted ? data[at] | m : data[at] & ~m
        }
      }
    })
    return new PdfStream(out, await deflate(data))
  }

  /** a form that reaches into an area, redacted as a private copy; false when nothing in it changed */
  private async form(x: PdfStream, parent: PdfDict, ctm: Matrix, depth: number): Promise<PdfStream | null | false> {
    if (depth >= MAX_DEPTH) return null
    const m = numbers(this.doc, x.dict.get('Matrix'))
    const own = this.doc.resolve(x.dict.get('Resources'))
    const res = isDict(own) ? own : parent
    const content = await decodeStream(x).catch(() => null)
    if (!content) return null
    const r = await this.stream(content, res, mul(m && m.length === 6 ? (m as Matrix) : IDENTITY, ctm), depth + 1)
    if (!r.changed) return false
    const dict = new Map(x.dict)
    for (const k of ['Filter', 'DecodeParms', 'Length']) dict.delete(k)
    dict.set('Filter', new PdfName('FlateDecode'))
    dict.set('Resources', r.res)
    return new PdfStream(dict, await deflate(r.content))
  }
}

const NO_PLATFORM: Platform = {
  imageFromRGBA: () => ({}) as CanvasImageSource,
  decodeJpeg: () => Promise.reject(new Error('not needed for analysis')),
}

/** the widgets and other annotations of a page whose rectangle meets an area */
function coveredAnnots(doc: PdfDocument, annots: PdfObj | undefined, areas: Box[]): Set<PdfObj> {
  const out = new Set<PdfObj>()
  const list = doc.resolve(annots)
  if (!Array.isArray(list)) return out
  for (const a of list) {
    const d = doc.resolve(a)
    const r = isDict(d) ? numbers(doc, d.get('Rect')) : null
    if (!r || r.length !== 4) continue
    const box: Box = [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]
    if (areas.some((ar) => meets(ar, box))) out.add(a)
  }
  return out
}

/** an area given as fractions of the page as displayed (rotation applied, y from the top), in page user space */
export function displayedArea(doc: PdfDocument, index: number, r: { x: number; y: number; w: number; h: number }): Box {
  const { box, rotate } = doc.pageBox(doc.pages()[index])
  const turned = rotate % 180 === 90
  const [w, h] = [box[2] - box[0], box[3] - box[1]]
  const [W, H] = turned ? [h, w] : [w, h]
  const back = invert(pageMatrix(box as Box, rotate, 1))
  const [x1, y1] = apply(back, r.x * W, r.y * H)
  const [x2, y2] = apply(back, (r.x + r.w) * W, (r.y + r.h) * H)
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)]
}

/**
 * Redact the areas (page user space, by page index) and write the file again. Form fields whose widgets were under an
 * area leave the form with their values.
 */
export async function redactPdf(doc: PdfDocument, areas: Map<number, Box[]>, options: RedactOptions): Promise<Uint8Array> {
  return editDocument(doc, async (e) => {
    const gone = new Set<number>()
    for (const [index, boxes] of areas) {
      const pageRef = e.pageRefs[index]
      const page = doc.pages()[index]
      if (!pageRef || !page || !boxes.length) continue
      const { content, res } = await pageContent(doc, index)
      const r = new Redactor(doc, e, boxes, options.platform)
      const done = await r.stream(content, res, IDENTITY, 0)
      const dict = e.edit(pageRef)
      const cover = boxes.map((b) => `${f4(b[0])} ${f4(b[1])} ${f4(b[2] - b[0])} ${f4(b[3] - b[1])} re`).join(' ')
      const enc = new TextEncoder()
      const body = new Uint8Array([...enc.encode('q\n'), ...done.content, ...enc.encode(`\nQ\nq 0 g ${cover} f Q\n`)])
      dict.set('Contents', e.add(new PdfStream(new Map([['Filter', new PdfName('FlateDecode')]]), await deflate(body))))
      if (done.res !== res || !page.dict.has('Resources')) dict.set('Resources', done.res)
      const covered = coveredAnnots(doc, page.dict.get('Annots'), boxes)
      if (covered.size) {
        const list = doc.resolve(page.dict.get('Annots'))
        dict.set('Annots', (Array.isArray(list) ? list : []).filter((a) => !covered.has(a)))
        for (const a of covered) if (a instanceof PdfRef) gone.add(a.num)
      }
      if (options.hidden) for (const k of ['Thumb', 'PieceInfo', 'Metadata']) dict.delete(k)
    }
    if (gone.size) pruneFields(doc, e, gone)
    if (options.hidden) {
      e.catalog.delete('Metadata')
      e.catalog.delete('PieceInfo')
      e.keepInfo = false
    }
  })
}

/** take the removed widgets out of the form, and the fields left without any widget with them */
function pruneFields(doc: PdfDocument, e: Editing, gone: Set<number>) {
  const formRef = e.catalog.get('AcroForm')
  const form = formRef instanceof PdfRef ? e.edit(formRef) : isDict(formRef) ? new Map(formRef) : null
  if (!form) return
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
  if (!(formRef instanceof PdfRef)) e.catalog.set('AcroForm', form)
}
