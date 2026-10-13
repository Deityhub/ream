import {
  Parser,
  PdfKeyword,
  PdfName,
  PdfStream,
  decodeStream,
  isDict,
  type Page,
  type PdfDict,
  type PdfDocument,
  type PdfObj,
} from '@ream/pdf-core'
import { DeviceCMYK, DeviceGray, DeviceRGB, css, loadColorSpace, type ColorSpace, type RGB } from './color.ts'
import { numbers } from './function.ts'
import { rasterizeImage, type Raster } from './image.ts'
import { IDENTITY, apply, mul, scaleOf, type Matrix } from './matrix.ts'
import type { Ctx2D, Platform } from './platform.ts'
import { clipToExtent, loadShading, makeGradient, type Shading } from './shading.ts'

const BLEND: Record<string, GlobalCompositeOperation> = {
  Normal: 'source-over', Compatible: 'source-over', Multiply: 'multiply', Screen: 'screen', Overlay: 'overlay',
  Darken: 'darken', Lighten: 'lighten', ColorDodge: 'color-dodge', ColorBurn: 'color-burn', HardLight: 'hard-light',
  SoftLight: 'soft-light', Difference: 'difference', Exclusion: 'exclusion', Hue: 'hue', Saturation: 'saturation',
  Color: 'color', Luminosity: 'luminosity',
}
const CAPS: CanvasLineCap[] = ['butt', 'round', 'square']
const JOINS: CanvasLineJoin[] = ['miter', 'round', 'bevel']
const MAX_FORM_DEPTH = 16
const MAX_OPERANDS = 256

type Pattern = { shading: Shading | null; matrix: Matrix }
type Paint = { cs: ColorSpace; comps: number[]; rgb: RGB; pattern: Pattern | null }

class GState {
  ctm: Matrix = IDENTITY
  fill: Paint = { cs: DeviceGray, comps: [0], rgb: [0, 0, 0], pattern: null }
  stroke: Paint = { cs: DeviceGray, comps: [0], rgb: [0, 0, 0], pattern: null }
  lineWidth = 1
  cap: CanvasLineCap = 'butt'
  join: CanvasLineJoin = 'miter'
  miter = 10
  dash: number[] = []
  dashPhase = 0
  fillAlpha = 1
  strokeAlpha = 1
  blend: GlobalCompositeOperation = 'source-over'

  clone(): GState {
    const g = new GState()
    Object.assign(g, this)
    g.dash = this.dash.slice()
    return g
  }
}

const isWs = (c: number | undefined) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0

/** Runs PDF content streams against a 2D canvas context. One instance draws one page. */
export class Interpreter {
  doc: PdfDocument
  ctx: Ctx2D
  platform: Platform
  /** user space of the page to device pixels */
  base: Matrix
  signal?: AbortSignal
  warnings = new Set<string>()
  state = new GState()
  private stack: GState[] = []
  private pendingClip: CanvasFillRule | null = null
  private cur: [number, number] = [0, 0]
  private start: [number, number] = [0, 0]
  private formDepth = 0
  private images = new Map<PdfStream, Promise<Raster | 'unsupported'>>()

  constructor(doc: PdfDocument, ctx: Ctx2D, platform: Platform, base: Matrix, signal?: AbortSignal) {
    this.doc = doc
    this.ctx = ctx
    this.platform = platform
    this.base = base
    this.signal = signal
  }

  warn(message: string) {
    this.warnings.add(message)
  }

  private applyCtm() {
    const m = mul(this.state.ctm, this.base)
    this.ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5])
  }

  private save() {
    this.ctx.save()
    this.stack.push(this.state.clone())
  }

  private restore() {
    const prev = this.stack.pop()
    if (!prev) return // an unbalanced Q: ignore it
    this.ctx.restore()
    this.state = prev
  }

  /** start a fresh graphics state with the given transform (used for annotations) */
  reset(ctm: Matrix) {
    this.state = new GState()
    this.state.ctm = ctm
    this.applyCtm()
    this.ctx.beginPath()
  }

  private lookup(res: PdfDict, kind: string, name: string): PdfObj {
    const table = this.doc.resolve(res.get(kind) ?? null)
    return isDict(table) ? this.doc.resolve(table.get(name) ?? null) : null
  }

  // ---------- the operator loop ----------

  async run(content: Uint8Array, res: PdfDict) {
    const p = new Parser(content)
    const depth = this.stack.length
    const args: PdfObj[] = []
    let ops = 0
    for (;;) {
      p.skipWs()
      if (p.pos >= content.length) break
      let v: PdfObj | PdfKeyword
      try {
        v = p.readValue()
      } catch {
        p.pos++ // unreadable bytes: skip one and carry on
        args.length = 0
        continue
      }
      if (!(v instanceof PdfKeyword)) {
        if (args.length < MAX_OPERANDS) args.push(v)
        continue
      }
      if (++ops % 512 === 0) this.signal?.throwIfAborted()
      try {
        if (v.value === 'BI') await this.inlineImage(p, res)
        else await this.exec(v.value, args, res)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        this.warn("Some drawing instructions couldn't be read")
      }
      args.length = 0
    }
    while (this.stack.length > depth) this.restore()
  }

  private async exec(op: string, a: PdfObj[], res: PdfDict) {
    const { ctx } = this
    const n = (i: number) => (typeof a[i] === 'number' ? (a[i] as number) : 0)
    const s = this.state
    switch (op) {
      // graphics state
      case 'q': this.save(); break
      case 'Q': this.restore(); break
      case 'cm':
        s.ctm = mul([n(0), n(1), n(2), n(3), n(4), n(5)], s.ctm)
        this.applyCtm()
        break
      case 'w': s.lineWidth = n(0); break
      case 'J': s.cap = CAPS[n(0)] ?? 'butt'; break
      case 'j': s.join = JOINS[n(0)] ?? 'miter'; break
      case 'M': s.miter = n(0); break
      case 'd': s.dash = Array.isArray(a[0]) ? (a[0].filter((x) => typeof x === 'number') as number[]) : []; s.dashPhase = n(1); break
      case 'gs': this.extGState(res, a[0]); break

      // path construction
      case 'm': ctx.moveTo(n(0), n(1)); this.cur = this.start = [n(0), n(1)]; break
      case 'l': ctx.lineTo(n(0), n(1)); this.cur = [n(0), n(1)]; break
      case 'c': ctx.bezierCurveTo(n(0), n(1), n(2), n(3), n(4), n(5)); this.cur = [n(4), n(5)]; break
      case 'v': ctx.bezierCurveTo(this.cur[0], this.cur[1], n(0), n(1), n(2), n(3)); this.cur = [n(2), n(3)]; break
      case 'y': ctx.bezierCurveTo(n(0), n(1), n(2), n(3), n(2), n(3)); this.cur = [n(2), n(3)]; break
      case 'h': ctx.closePath(); this.cur = this.start; break
      case 're': ctx.rect(n(0), n(1), n(2), n(3)); this.cur = this.start = [n(0), n(1)]; break

      // path painting and clipping
      case 'S': this.paint(false, true, 'nonzero'); break
      case 's': ctx.closePath(); this.paint(false, true, 'nonzero'); break
      case 'f': case 'F': this.paint(true, false, 'nonzero'); break
      case 'f*': this.paint(true, false, 'evenodd'); break
      case 'B': this.paint(true, true, 'nonzero'); break
      case 'B*': this.paint(true, true, 'evenodd'); break
      case 'b': ctx.closePath(); this.paint(true, true, 'nonzero'); break
      case 'b*': ctx.closePath(); this.paint(true, true, 'evenodd'); break
      case 'n': this.paint(false, false, 'nonzero'); break
      case 'W': this.pendingClip = 'nonzero'; break
      case 'W*': this.pendingClip = 'evenodd'; break

      // colour
      case 'g': s.fill = this.solid(DeviceGray, [n(0)]); break
      case 'G': s.stroke = this.solid(DeviceGray, [n(0)]); break
      case 'rg': s.fill = this.solid(DeviceRGB, [n(0), n(1), n(2)]); break
      case 'RG': s.stroke = this.solid(DeviceRGB, [n(0), n(1), n(2)]); break
      case 'k': s.fill = this.solid(DeviceCMYK, [n(0), n(1), n(2), n(3)]); break
      case 'K': s.stroke = this.solid(DeviceCMYK, [n(0), n(1), n(2), n(3)]); break
      case 'cs': { const cs = await loadColorSpace(this.doc, a[0], res); s.fill = this.solid(cs, cs.initial); break }
      case 'CS': { const cs = await loadColorSpace(this.doc, a[0], res); s.stroke = this.solid(cs, cs.initial); break }
      case 'sc': case 'scn': s.fill = await this.setColor(s.fill, a, res); break
      case 'SC': case 'SCN': s.stroke = await this.setColor(s.stroke, a, res); break
      case 'sh': await this.shade(a[0], res); break

      // things drawn by name
      case 'Do': await this.xobject(a[0], res); break

      // text arrives with the font engine (stage R2); until then say the page is incomplete
      case 'Tj': case 'TJ': case "'": case '"': this.warn("Text isn't drawn yet"); break
      default: break // BT ET Tf Td ... marked content, compatibility and other operators have no drawing effect here
    }
  }

  // ---------- state helpers ----------

  private solid(cs: ColorSpace, comps: number[]): Paint {
    return { cs, comps, rgb: cs.isPattern ? [0, 0, 0] : cs.rgb(comps), pattern: null }
  }

  private async setColor(prev: Paint, a: PdfObj[], res: PdfDict): Promise<Paint> {
    const last = a[a.length - 1]
    if (last instanceof PdfName) {
      const pat = this.lookup(res, 'Pattern', last.value)
      const dict = pat instanceof PdfStream ? pat.dict : isDict(pat) ? pat : null
      if (dict && this.doc.resolve(dict.get('PatternType')) === 2) {
        const shading = await loadShading(this.doc, dict.get('Shading'), res)
        if (!shading) this.warn("Some shading patterns couldn't be drawn")
        const m = numbers(this.doc, dict.get('Matrix'))
        return { ...prev, pattern: { shading, matrix: m && m.length === 6 ? (m as Matrix) : IDENTITY }, rgb: shading?.mid ?? [128, 128, 128] }
      }
      this.warn("Tiling patterns aren't drawn yet")
      return { ...prev, pattern: { shading: null, matrix: IDENTITY }, rgb: [200, 200, 200] }
    }
    const comps = a.filter((x): x is number => typeof x === 'number')
    return this.solid(prev.cs, comps.length ? comps : prev.cs.initial)
  }

  private extGState(res: PdfDict, name: PdfObj | undefined) {
    if (!(name instanceof PdfName)) return
    const g = this.lookup(res, 'ExtGState', name.value)
    if (!isDict(g)) return
    const s = this.state
    for (const [k, raw] of g) {
      const v = this.doc.resolve(raw)
      if (k === 'LW' && typeof v === 'number') s.lineWidth = v
      else if (k === 'LC' && typeof v === 'number') s.cap = CAPS[v] ?? 'butt'
      else if (k === 'LJ' && typeof v === 'number') s.join = JOINS[v] ?? 'miter'
      else if (k === 'ML' && typeof v === 'number') s.miter = v
      else if (k === 'CA' && typeof v === 'number') s.strokeAlpha = v
      else if (k === 'ca' && typeof v === 'number') s.fillAlpha = v
      else if (k === 'D' && Array.isArray(v)) {
        const arr = this.doc.resolve(v[0])
        s.dash = Array.isArray(arr) ? (arr.map((x) => this.doc.resolve(x)).filter((x) => typeof x === 'number') as number[]) : []
        const phase = this.doc.resolve(v[1])
        s.dashPhase = typeof phase === 'number' ? phase : 0
      } else if (k === 'BM') {
        const m = Array.isArray(v) ? this.doc.resolve(v[0]) : v
        s.blend = (m instanceof PdfName && BLEND[m.value]) || 'source-over'
      } else if (k === 'SMask' && v instanceof Map) this.warn("Soft masks aren't applied yet")
    }
  }

  // ---------- painting ----------

  private paint(fill: boolean, stroke: boolean, rule: CanvasFillRule) {
    const { ctx, state: s } = this
    if (fill) {
      ctx.globalCompositeOperation = s.blend
      ctx.globalAlpha = s.fillAlpha
      const pattern = s.fill.pattern
      if (pattern?.shading) {
        // a shading pattern lives in the page's coordinate system: clip to the path, then flood the plane with the gradient
        ctx.save()
        ctx.clip(rule)
        const pm = mul(pattern.matrix, this.base)
        ctx.setTransform(pm[0], pm[1], pm[2], pm[3], pm[4], pm[5])
        clipToExtent(ctx, pattern.shading)
        ctx.fillStyle = makeGradient(ctx, pattern.shading)
        ctx.fillRect(-1e7, -1e7, 2e7, 2e7)
        ctx.restore()
      } else {
        ctx.fillStyle = pattern ? 'rgb(200,200,200)' : css(s.fill.rgb)
        ctx.fill(rule)
      }
    }
    if (stroke) {
      ctx.globalCompositeOperation = s.blend
      ctx.globalAlpha = s.strokeAlpha
      ctx.strokeStyle = s.stroke.pattern ? 'rgb(128,128,128)' : css(s.stroke.rgb)
      // a width of 0 means the thinnest line the device can draw
      ctx.lineWidth = s.lineWidth > 0 ? s.lineWidth : 1 / (scaleOf(mul(s.ctm, this.base)) || 1)
      ctx.lineCap = s.cap
      ctx.lineJoin = s.join
      ctx.miterLimit = s.miter
      ctx.setLineDash(s.dash.every((d) => d === 0) ? [] : s.dash)
      ctx.lineDashOffset = s.dashPhase
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    if (this.pendingClip) {
      ctx.clip(this.pendingClip)
      this.pendingClip = null
    }
    ctx.beginPath()
  }

  /** the `sh` operator: fill everything inside the current clip with a shading */
  private async shade(name: PdfObj | undefined, res: PdfDict) {
    if (!(name instanceof PdfName)) return
    const shading = await loadShading(this.doc, this.lookup(res, 'Shading', name.value), res)
    if (!shading) {
      this.warn("Some shadings couldn't be drawn")
      return
    }
    const { ctx, state: s } = this
    ctx.save()
    ctx.globalAlpha = s.fillAlpha
    ctx.globalCompositeOperation = s.blend
    clipToExtent(ctx, shading)
    ctx.fillStyle = makeGradient(ctx, shading)
    ctx.fillRect(-1e7, -1e7, 2e7, 2e7)
    ctx.restore()
  }

  // ---------- XObjects ----------

  private async xobject(name: PdfObj | undefined, res: PdfDict) {
    if (!(name instanceof PdfName)) return
    const x = this.lookup(res, 'XObject', name.value)
    if (!(x instanceof PdfStream)) return
    const subtype = this.doc.resolve(x.dict.get('Subtype'))
    if (subtype instanceof PdfName && subtype.value === 'Image') await this.drawImage(x, res)
    else if (subtype instanceof PdfName && subtype.value === 'Form') await this.form(x, res)
  }

  async form(f: PdfStream, parent: PdfDict) {
    if (this.formDepth >= MAX_FORM_DEPTH) {
      this.warn('Forms nested too deeply to draw')
      return
    }
    this.formDepth++
    this.save()
    try {
      const m = numbers(this.doc, f.dict.get('Matrix'))
      if (m && m.length === 6) {
        this.state.ctm = mul(m as Matrix, this.state.ctm)
        this.applyCtm()
      }
      const bb = numbers(this.doc, f.dict.get('BBox'))
      if (bb && bb.length === 4) {
        this.ctx.beginPath()
        this.ctx.rect(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1])
        this.ctx.clip()
        this.ctx.beginPath()
      }
      const res = this.doc.resolve(f.dict.get('Resources'))
      await this.run(await decodeStream(f), isDict(res) ? res : parent)
    } finally {
      this.restore()
      this.formDepth--
    }
  }

  private async drawImage(img: PdfStream, res: PdfDict) {
    const isMask = this.doc.resolve(img.dict.get('ImageMask') ?? img.dict.get('IM')) === true
    // stencil masks take the current fill colour, so they can't be shared between uses
    let r = isMask ? undefined : this.images.get(img)
    if (!r) {
      r = rasterizeImage({ doc: this.doc, platform: this.platform, resources: res, fill: this.state.fill.rgb, warn: (m) => this.warn(m) }, img)
      if (!isMask) this.images.set(img, r)
    }
    this.paintRaster(await r)
  }

  private paintRaster(r: Raster | 'unsupported') {
    const { ctx, state: s } = this
    ctx.save()
    ctx.globalAlpha = s.fillAlpha
    ctx.globalCompositeOperation = s.blend
    if (r === 'unsupported') {
      ctx.fillStyle = 'rgb(208,208,208)' // marks where a picture we can't decode yet belongs
      ctx.fillRect(0, 0, 1, 1)
    } else {
      // an image fills the unit square, its first row at the top
      ctx.transform(1 / r.width, 0, 0, -1 / r.height, 0, 1)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(this.platform.imageFromRGBA(r.width, r.height, r.rgba), 0, 0)
    }
    ctx.restore()
  }

  /** BI <key value ...> ID <data> EI */
  private async inlineImage(p: Parser, res: PdfDict) {
    const dict: PdfDict = new Map()
    for (;;) {
      const k = p.readValue()
      if (k instanceof PdfKeyword) {
        if (k.value === 'ID') break
        continue
      }
      if (!(k instanceof PdfName)) continue
      const v = p.readValue()
      if (v instanceof PdfKeyword) break
      dict.set(k.value, v)
    }
    const d = p.data
    let start = p.pos
    if (d[start] === 13 && d[start + 1] === 10) start += 2
    else if (isWs(d[start])) start++

    // without a filter the data length is known; otherwise look for EI between whitespace, followed by plausible text
    let end = -1
    const filtered = dict.has('Filter') || dict.has('F')
    if (!filtered) {
      const w = Number(dict.get('Width') ?? dict.get('W')) || 0
      const h = Number(dict.get('Height') ?? dict.get('H')) || 0
      const isMask = (dict.get('ImageMask') ?? dict.get('IM')) === true
      const bpc = isMask ? 1 : Number(dict.get('BitsPerComponent') ?? dict.get('BPC')) || 8
      const n = isMask ? 1 : (await loadColorSpace(this.doc, dict.get('ColorSpace') ?? dict.get('CS'), res)).n
      end = start + ((w * n * bpc + 7) >> 3) * h
    }
    let at = filtered ? start : end
    let found = -1
    for (; at < d.length - 1; at++) {
      if (d[at] === 69 && d[at + 1] === 73 && (at === start || isWs(d[at - 1])) && (at + 2 >= d.length || isWs(d[at + 2]))) {
        const tail = d.subarray(at + 2, at + 12)
        if (tail.every((c) => c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127))) {
          found = at
          break
        }
      }
    }
    if (found < 0) {
      p.pos = d.length
      return
    }
    const dataEnd = filtered ? (isWs(d[found - 1]) ? found - 1 : found) : Math.min(end, found)
    p.pos = found + 2
    this.paintRaster(await rasterizeImage({ doc: this.doc, platform: this.platform, resources: res, fill: this.state.fill.rgb, warn: (m) => this.warn(m) }, new PdfStream(dict, d.subarray(start, dataEnd))))
  }

  // ---------- annotations ----------

  /** draw each annotation's normal appearance stream into its rectangle (ISO 32000-1 algorithm 8.1) */
  async annotations(page: Page) {
    const annots = this.doc.resolve(page.dict.get('Annots'))
    if (!Array.isArray(annots)) return
    for (const ref of annots) {
      const a = this.doc.resolve(ref)
      if (!isDict(a)) continue
      const flags = this.doc.resolve(a.get('F'))
      if (typeof flags === 'number' && (flags & 2 || flags & 32)) continue // hidden, or not for viewing
      const sub = this.doc.resolve(a.get('Subtype'))
      if (sub instanceof PdfName && sub.value === 'Popup') continue
      const ap = this.doc.resolve(a.get('AP'))
      let normal = isDict(ap) ? this.doc.resolve(ap.get('N')) : null
      if (isDict(normal)) {
        const state = this.doc.resolve(a.get('AS'))
        normal = state instanceof PdfName ? this.doc.resolve(normal.get(state.value)) : null
      }
      if (!(normal instanceof PdfStream)) continue
      const rect = numbers(this.doc, a.get('Rect'))
      const bbox = numbers(this.doc, normal.dict.get('BBox'))
      if (!rect || rect.length !== 4 || !bbox || bbox.length !== 4) continue
      const m = (numbers(this.doc, normal.dict.get('Matrix')) as Matrix | null) ?? IDENTITY
      const corners = [apply(m, bbox[0], bbox[1]), apply(m, bbox[2], bbox[1]), apply(m, bbox[0], bbox[3]), apply(m, bbox[2], bbox[3])]
      const [bx0, bx1] = [Math.min(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[0]))]
      const [by0, by1] = [Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[1]))]
      const [rx0, rx1] = [Math.min(rect[0], rect[2]), Math.max(rect[0], rect[2])]
      const [ry0, ry1] = [Math.min(rect[1], rect[3]), Math.max(rect[1], rect[3])]
      const sx = bx1 > bx0 ? (rx1 - rx0) / (bx1 - bx0) : 1
      const sy = by1 > by0 ? (ry1 - ry0) / (by1 - by0) : 1
      this.ctx.save()
      try {
        this.reset([sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy])
        await this.form(normal, new Map())
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        this.warn("An annotation couldn't be drawn")
      } finally {
        this.ctx.restore()
        this.stack.length = 0
      }
    }
  }
}
