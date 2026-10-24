import {
  Parser,
  PdfKeyword,
  PdfName,
  PdfStream,
  PdfString,
  appearanceMatrix,
  decodeStream,
  isVisibleAnnotation,
  normalAppearance,
  isDict,
  isName,
  type Page,
  type PdfDict,
  type PdfDocument,
  type PdfObj,
} from '@ream/pdf-core'
import { DeviceCMYK, DeviceGray, DeviceRGB, css, loadColorSpace, type ColorSpace, type RGB } from './color.ts'
import { fallbackFont, loadFont, type Font, type Glyph, type GlyphShape } from './font.ts'
import { readTrueType, tracePath, type TrueTypeProgram } from './outlines/index.ts'
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
  // text state (saved and restored by q and Q like the rest)
  charSpace = 0
  wordSpace = 0
  hScale = 1
  leading = 0
  rise = 0
  renderMode = 0
  font: Font | null = null
  /** the name the font has in the resources (Tf's operand) */
  fontName: string | null = null
  fontSize = 0

  clone(): GState {
    const g = new GState()
    Object.assign(g, this)
    g.dash = this.dash.slice()
    return g
  }
}

const isWs = (c: number | undefined) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0

/** what `onOp` is told about one top-level operator of a recorded content stream */
export type OpInfo = {
  op: string
  args: PdfObj[]
  /** byte range of the operands and operator in the stream, [start, end) */
  start: number
  end: number
  /** the text matrix before and after the operator */
  tmBefore: Matrix
  tmAfter: Matrix
  fontSize: number
  hScale: number
  renderMode: number
  /** a glyph shown by this operator had no width in its font, so the text advance is only an estimate */
  unknownWidth: boolean
  /** the transform the operator ran under (paths are in this space) */
  ctm: Matrix
}

/**
 * One glyph of a string shown by the stream being recorded, for redaction: where its code sits in the operator's
 * strings, how far it moved the text position, and the corners of its em box (descent to ascent over its advance).
 */
export type ShownGlyph = {
  /** which string of a TJ array (0 for the other text operators) */
  item: number
  /** byte offset and length of the code in that string */
  offset: number
  length: number
  /** the move along the line in text space units, character and word spacing included */
  tx: number
  quad: [number, number][]
  /** what it reads as ('' when the font doesn't say) */
  text: string
  /** the text state it was shown with, so it can be shown again: the font and its name in the resources, the text matrix before it, the CTM */
  font: Font
  fontName: string | null
  fontSize: number
  hScale: number
  rise: number
  tm: Matrix
  ctm: Matrix
  /** fill colour, 0..1 each */
  fill: [number, number, number]
  renderMode: number
}

/** one shown glyph with where it is, for text extraction: start and end of its baseline in the space `base` maps to */
export type GlyphInfo = {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  /** the font size in that space */
  size: number
  bold: boolean
  italic: boolean
  /** the font's name as people write it, and its kind (see `Font`) */
  face: string
  kind: 'sans' | 'serif' | 'mono'
  /** fill colour, 0..255 each */
  color: [number, number, number]
  renderMode: number
}

export type HideBox = { x: number; y: number; w: number; h: number }
const inBox = (boxes: HideBox[], x: number, y: number) => boxes.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)

function pathOf(path: GlyphShape['path']): Path2D {
  const p = new Path2D()
  tracePath(p, path)
  return p
}

/** Runs PDF content streams against a 2D canvas context. One instance draws one page. */
export class Interpreter {
  doc: PdfDocument
  ctx: Ctx2D
  platform: Platform
  /** user space of the page to device pixels */
  base: Matrix
  signal?: AbortSignal
  warnings = new Set<string>()
  /** told about every top-level operator when `run` is called with `record` (used to find where things are painted) */
  onOp?: (info: OpInfo) => void
  /** told about every glyph that has text, at any depth (forms, annotation appearances) */
  onGlyph?: (glyph: GlyphInfo) => void
  /** analysis only: pictures are not decoded and count as their unit square */
  analysis = false
  /** draw the page without its text (it is still read: onGlyph sees it): the design of a page under editable text */
  skipText = false
  /**
   * What an editor has changed on this page, left out of the picture (the page's own stream only): letters whose middle
   * is in a `text` box, pictures whose middle is in a `pictures` box. Boxes are fractions of the page as displayed
   * (`width` and `height`: its size in device pixels), the same test the saved file uses to take them out.
   */
  hide: { text: HideBox[]; pictures: HideBox[]; width: number; height: number } | null = null
  /** told about every picture XObject that is painted (at any depth), with the matrix that maps its unit square into the space the page's own content uses */
  onImage?: (image: PdfStream, ctm: Matrix, inline?: boolean) => void
  /** told about every glyph of the strings of the stream being recorded (not of the forms or glyph procedures it uses) */
  onShow?: (glyph: ShownGlyph) => void
  /** forms (and Type 3 glyph procedures) the interpreter is inside: hooks compare it with `recordDepth` */
  get depth() {
    return this.formDepth
  }
  /** the depth of the stream `run` was asked to record */
  recordDepth = -1
  private showItem = 0
  private unknownWidth = false
  state = new GState()
  private stack: GState[] = []
  private pendingClip: CanvasFillRule | null = null
  private cur: [number, number] = [0, 0]
  private start: [number, number] = [0, 0]
  private formDepth = 0
  // the text object: current text matrix and line matrix (not part of the graphics state)
  private tm: Matrix = IDENTITY
  private tlm: Matrix = IDENTITY
  private fontString = ''
  private measured = new Map<string, number>()
  private images = new Map<PdfStream, Promise<Raster | 'unsupported'>>()
  /** a browser canvas (not a test's recorder or the bounds context): glyphs can be drawn as cached Path2D objects */
  private realCanvas: boolean
  /** the bundled look-alikes for standard fonts, by kind, weight and slant */
  private standards = new Map<string, Promise<TrueTypeProgram[]>>()
  /** glyphs shown in a clipping render mode in this text object, each with its device matrix: the clip at ET */
  private textClip: { m: Matrix; path: GlyphShape['path'] | null; w: number }[] | null = null

  constructor(doc: PdfDocument, ctx: Ctx2D, platform: Platform, base: Matrix, signal?: AbortSignal) {
    this.doc = doc
    this.ctx = ctx
    this.platform = platform
    this.base = base
    this.signal = signal
    const canvasTypes = [globalThis.OffscreenCanvasRenderingContext2D, globalThis.CanvasRenderingContext2D].filter(Boolean)
    this.realCanvas = typeof Path2D === 'function' && canvasTypes.some((t) => ctx instanceof t)
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
    this.fontString = '' // the canvas font is part of the state that was just restored, so it must be set again
    this.state = prev
  }

  /** start a fresh graphics state with the given transform (used for annotations) */
  reset(ctm: Matrix) {
    this.state = new GState()
    this.state.ctm = ctm
    this.fontString = ''
    this.applyCtm()
    this.ctx.beginPath()
  }

  private lookup(res: PdfDict, kind: string, name: string): PdfObj {
    const table = this.doc.resolve(res.get(kind) ?? null)
    return isDict(table) ? this.doc.resolve(table.get(name) ?? null) : null
  }

  // ---------- the operator loop ----------

  /** `record`: report each operator of this stream to `onOp` (only for the page's own stream, not forms or glyph procedures) */
  async run(content: Uint8Array, res: PdfDict, record = false) {
    if (record) this.recordDepth = this.formDepth
    const p = new Parser(content)
    const depth = this.stack.length
    const args: PdfObj[] = []
    let argStart = -1
    let ops = 0
    for (;;) {
      p.skipWs()
      if (p.pos >= content.length) break
      const before = p.pos
      let v: PdfObj | PdfKeyword
      try {
        v = p.readValue()
      } catch {
        p.pos++ // unreadable bytes: skip one and carry on
        args.length = 0
        argStart = -1
        continue
      }
      if (!(v instanceof PdfKeyword)) {
        if (!args.length) argStart = before
        if (args.length < MAX_OPERANDS) args.push(v)
        continue
      }
      if (++ops % 512 === 0) this.signal?.throwIfAborted()
      const start = args.length ? argStart : before
      const tmBefore = this.tm
      this.unknownWidth = false
      try {
        if (v.value === 'BI') await this.inlineImage(p, res)
        else await this.exec(v.value, args, res)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        this.warn("Some drawing instructions couldn't be read")
      }
      if (record) {
        const s = this.state
        this.onOp?.({ op: v.value, args: args.slice(), start, end: p.pos, tmBefore, tmAfter: this.tm, fontSize: s.fontSize, hScale: s.hScale, renderMode: s.renderMode, unknownWidth: this.unknownWidth, ctm: s.ctm })
      }
      args.length = 0
      argStart = -1
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

      // text
      case 'BT': this.tm = this.tlm = IDENTITY; this.textClip = null; break
      case 'ET': this.clipToText(); break
      case 'Tc': s.charSpace = n(0); break
      case 'Tw': s.wordSpace = n(0); break
      case 'Tz': s.hScale = n(0) / 100; break
      case 'TL': s.leading = n(0); break
      case 'Ts': s.rise = n(0); break
      case 'Tr': s.renderMode = n(0); break
      case 'Tf': {
        const f = a[0] instanceof PdfName ? this.lookup(res, 'Font', a[0].value) : null
        s.font = f === null ? fallbackFont : await loadFont(this.doc, f)
        s.fontName = a[0] instanceof PdfName && f !== null ? a[0].value : null
        s.fontSize = n(1)
        break
      }
      case 'Td': this.moveLine(n(0), n(1)); break
      case 'TD': s.leading = -n(1); this.moveLine(n(0), n(1)); break
      case 'Tm': this.tm = this.tlm = [n(0), n(1), n(2), n(3), n(4), n(5)]; break
      case 'T*': this.moveLine(0, -s.leading); break
      case 'Tj': this.showItem = 0; if (a[0] instanceof PdfString) await this.show(a[0].bytes, res); break
      case "'": this.showItem = 0; this.moveLine(0, -s.leading); if (a[0] instanceof PdfString) await this.show(a[0].bytes, res); break
      case '"':
        s.wordSpace = n(0)
        s.charSpace = n(1)
        this.moveLine(0, -s.leading)
        this.showItem = 0
        if (a[2] instanceof PdfString) await this.show(a[2].bytes, res)
        break
      case 'TJ':
        if (Array.isArray(a[0])) {
          for (const [i, item] of a[0].entries()) {
            this.showItem = i
            if (item instanceof PdfString) await this.show(item.bytes, res)
            // a number moves the text position back (positive) or forward, in thousandths of the font size
            else if (typeof item === 'number') this.tm = mul([1, 0, 0, 1, (-item / 1000) * s.fontSize * s.hScale, 0], this.tm)
          }
        }
        break
      default: break // marked content, compatibility and other operators have no drawing effect here
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

  // ---------- text ----------

  private moveLine(tx: number, ty: number) {
    this.tlm = mul([1, 0, 0, 1, tx, ty], this.tlm)
    this.tm = this.tlm
  }

  /** width in pixels of `text` in the given canvas font, measured once */
  private measure(font: string, text: string): number {
    const key = `${font}|${text}`
    let w = this.measured.get(key)
    if (w === undefined) this.measured.set(key, (w = this.ctx.measureText(text).width))
    return w
  }

  /** a bundled look-alike's glyph for a standard font the file doesn't embed, found by the glyph's text */
  private async standardShapes(font: Font): Promise<((g: Glyph) => GlyphShape | null) | null> {
    const std = font.standard
    if (!std || !this.platform.standardFont || this.analysis) return null
    const key = `${std.kind}${std.bold ? 'b' : ''}${std.italic ? 'i' : ''}`
    let parts = this.standards.get(key)
    if (!parts) {
      parts = this.platform.standardFont(std.kind, std.bold, std.italic).then(
        (files) => files.flatMap((f) => { try { return [readTrueType(f)] } catch { return [] } }),
        () => [],
      )
      this.standards.set(key, parts)
    }
    const programs = await parts
    if (!programs.length) return null
    const seen = new Map<string, GlyphShape | null>()
    return (g) => {
      if (!g.text) return null
      let shape = seen.get(g.text)
      if (shape === undefined) {
        shape = null
        for (const p of programs) {
          const gid = p.byUnicode(g.text)
          const path = gid === undefined ? null : p.glyph(gid)
          if (path) {
            shape = { path, matrix: p.matrix, width: p.advance(gid!) }
            break
          }
        }
        seen.set(g.text, shape)
      }
      return shape
    }
  }

  /**
   * Draw a shown string glyph by glyph. Each glyph goes where the PDF puts it, and the position advances by the PDF's
   * own width for it. The letter's shape comes from the embedded font program; without one, from a similar system
   * font squeezed to the PDF's width.
   */
  private async show(bytes: Uint8Array, res: PdfDict) {
    const { ctx, state: s } = this
    const font = s.font
    if (!font) return
    const sign = s.fontSize < 0 ? -1 : 1
    const size = Math.abs(s.fontSize) || 1
    // Canvas text misrenders at tiny sizes (Quartz writes "1 Tf" and scales with the text matrix), so draw at a
    // comfortable size and let the transform scale it back: k is that scale.
    const drawSize = Math.min(100, Math.max(16, size))
    const k = size / drawSize
    const glyphs = font.decode(bytes)
    for (const note of font.notes) this.warn(note)
    const mode = s.renderMode
    const fillMode = mode === 0 || mode === 2 || mode === 4 || mode === 6
    const strokeMode = mode === 1 || mode === 2 || mode === 5 || mode === 6
    const clipIt = mode >= 4
    if (clipIt) this.textClip ??= []
    const draws = !this.skipText && !this.analysis
    // embedded outlines also give widths when the PDF has none; they are only drawn on a real page
    const shapeOf = font.shape ?? (draws ? await this.standardShapes(font) : null)

    let offset = 0
    for (const g of glyphs) {
      let advance = g.width ?? 0
      const shape = shapeOf?.(g) ?? null
      // a letter the editor has changed or moved is not drawn here (it still advances the text position)
      const gone = this.hiddenLetter(g.width ?? shape?.width ?? 500)
      const fillIt = fillMode && !gone
      const strokeIt = strokeMode && !gone
      if (font.type3) {
        if (mode !== 3 && !this.skipText) await this.type3Glyph(font, g, res)
      } else if (shape && draws) {
        if (g.width === null) {
          advance = shape.width ?? 0
          if (shape.width === undefined) this.unknownWidth = true
        }
        const m = mul(shape.matrix, mul([s.fontSize * s.hScale, 0, 0, s.fontSize, 0, s.rise], mul(this.tm, mul(s.ctm, this.base))))
        if ((fillIt || strokeIt) && shape.path.length) {
          ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5])
          // a real canvas fills a Path2D made once per glyph: one call instead of one per curve
          let p2d: Path2D | undefined
          if (this.realCanvas) p2d = shape.path2d ??= pathOf(shape.path)
          else {
            ctx.beginPath()
            tracePath(ctx, shape.path)
          }
          ctx.globalCompositeOperation = s.blend
          if (fillIt) {
            ctx.globalAlpha = s.fillAlpha
            ctx.fillStyle = css(s.fill.rgb)
            if (p2d) ctx.fill(p2d, 'nonzero')
            else ctx.fill('nonzero')
          }
          if (strokeIt) {
            ctx.globalAlpha = s.strokeAlpha
            ctx.strokeStyle = css(s.stroke.rgb)
            ctx.lineWidth = (s.lineWidth * scaleOf(mul(s.ctm, this.base))) / (scaleOf(m) || 1)
            if (p2d) ctx.stroke(p2d)
            else ctx.stroke()
          }
          ctx.globalAlpha = 1
          ctx.globalCompositeOperation = 'source-over'
          ctx.beginPath()
          this.applyCtm()
        }
        if (clipIt) this.textClip!.push({ m, path: shape.path, w: 0 })
      } else if (g.text) {
        const fontString = `${font.italic ? 'italic ' : ''}${font.bold ? 'bold ' : ''}${drawSize}px ${font.family}`
        if (this.fontString !== fontString) {
          ctx.font = fontString
          this.fontString = fontString
        }
        const natural = this.measure(fontString, g.text)
        if (g.width === null) {
          advance = shape?.width ?? (natural / drawSize) * 1000
          if (shape?.width === undefined) this.unknownWidth = true
        }
        if (draws && shapeOf && !shape && g.text.trim() !== '' && !font.standard) this.warn('Some letters are shown with a similar font')
        if ((fillIt || strokeIt) && g.text.trim() !== '' && !this.skipText) {
          // a stand-in font's letters are rarely as wide as the original's: squeeze or stretch each to its slot
          let fit = 1
          if (g.width !== null && natural > 0) fit = Math.min(2, Math.max(0.5, ((g.width / 1000) * drawSize) / natural))
          if (Math.abs(fit - 1) < 0.02) fit = 1
          // canvas text is y-down, PDF space is y-up: the glyph carries its own vertical flip
          const glyph: Matrix = [s.hScale * sign * fit * k, 0, 0, -sign * k, 0, s.rise]
          const m = mul(glyph, mul(this.tm, mul(s.ctm, this.base)))
          ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5])
          ctx.globalCompositeOperation = s.blend
          if (fillIt) {
            ctx.globalAlpha = s.fillAlpha
            ctx.fillStyle = css(s.fill.rgb)
            ctx.fillText(g.text, 0, 0)
          }
          if (strokeIt) {
            ctx.globalAlpha = s.strokeAlpha
            ctx.strokeStyle = css(s.stroke.rgb)
            ctx.lineWidth = (s.lineWidth * scaleOf(mul(s.ctm, this.base))) / (scaleOf(m) || 1)
            ctx.strokeText(g.text, 0, 0)
          }
          ctx.globalAlpha = 1
          ctx.globalCompositeOperation = 'source-over'
          this.applyCtm()
        }
        if (clipIt && g.text.trim() !== '') {
          // ponytail: a letter without an outline clips as its box (the em square over its advance); exact only with outlines
          this.textClip!.push({ m: mul([s.fontSize * s.hScale, 0, 0, s.fontSize, 0, s.rise], mul(this.tm, mul(s.ctm, this.base))), path: null, w: advance / 1000 })
        }
      }
      const tx = ((advance / 1000) * s.fontSize + s.charSpace + (g.space ? s.wordSpace : 0)) * s.hScale
      if (this.onShow && this.formDepth === this.recordDepth) {
        // the em box over the glyph's advance (a little wide for marks with none), descent to ascent
        const m = mul([s.fontSize * s.hScale, 0, 0, s.fontSize, 0, s.rise], mul(this.tm, mul(s.ctm, this.base)))
        const w = Math.max(advance / 1000, 0.25)
        this.onShow({
          item: this.showItem, offset, length: g.bytes ?? 1, tx, quad: [apply(m, 0, -0.25), apply(m, w, -0.25), apply(m, w, 1), apply(m, 0, 1)],
          text: g.text, font, fontName: s.fontName, fontSize: s.fontSize, hScale: s.hScale, rise: s.rise, tm: this.tm, ctm: s.ctm, fill: [s.fill.rgb[0] / 255, s.fill.rgb[1] / 255, s.fill.rgb[2] / 255], renderMode: mode,
        })
      }
      offset += g.bytes ?? 1
      if (this.onGlyph && g.text) {
        const to = mul(s.ctm, this.base)
        const from = mul([1, 0, 0, 1, 0, s.rise], mul(this.tm, to))
        const next = mul([1, 0, 0, 1, 0, s.rise], mul(mul([1, 0, 0, 1, tx, 0], this.tm), to))
        this.onGlyph({ text: g.text, x0: from[4], y0: from[5], x1: next[4], y1: next[5], size: Math.abs(s.fontSize) * Math.hypot(from[2], from[3]), bold: font.bold, italic: font.italic, face: font.face, kind: font.kind, color: [s.fill.rgb[0], s.fill.rgb[1], s.fill.rgb[2]], renderMode: mode })
      }
      this.tm = mul([1, 0, 0, 1, tx, 0], this.tm)
    }
  }

  /** ET after text in a clipping render mode: the union of those glyphs is intersected with the clip (PDF 9.3.6) */
  private clipToText() {
    const glyphs = this.textClip
    this.textClip = null
    if (!glyphs || this.analysis) return
    const { ctx } = this
    ctx.beginPath()
    // canvas maps each point through the transform current when it is added, so one path can mix glyph matrices
    for (const g of glyphs) {
      ctx.setTransform(g.m[0], g.m[1], g.m[2], g.m[3], g.m[4], g.m[5])
      if (g.path) tracePath(ctx, g.path)
      else ctx.rect(0, -0.2, g.w, 1)
    }
    ctx.clip('nonzero')
    ctx.beginPath()
    this.applyCtm()
  }

  /** a Type 3 glyph is a little content stream, drawn in glyph space scaled up by the font matrix and size */
  private async type3Glyph(font: Font, g: Glyph, res: PdfDict) {
    const t3 = font.type3!
    const proc = g.name === undefined ? null : this.doc.resolve(t3.procs.get(g.name) ?? null)
    if (!(proc instanceof PdfStream) || this.formDepth >= MAX_FORM_DEPTH) return
    const { tm, tlm } = this
    this.formDepth++
    this.save()
    try {
      const s = this.state
      s.ctm = mul(t3.matrix, mul([s.fontSize * s.hScale, 0, 0, s.fontSize, 0, s.rise], mul(tm, s.ctm)))
      this.applyCtm()
      await this.run(await decodeStream(proc), t3.resources ?? res)
    } finally {
      this.restore()
      this.formDepth--
      this.tm = tm
      this.tlm = tlm
    }
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

  /** the letter being shown has its middle in a hidden box */
  private hiddenLetter(width: number): boolean {
    const h = this.hide
    if (!h?.text.length || this.formDepth !== 0) return false
    const s = this.state
    const m = mul([s.fontSize * s.hScale, 0, 0, s.fontSize, 0, s.rise], mul(this.tm, mul(s.ctm, this.base)))
    const [x, y] = apply(m, Math.max(width / 1000, 0.25) / 2, 0.375)
    return inBox(h.text, x / h.width, y / h.height)
  }

  /** the picture about to be drawn has its middle in a hidden box */
  private hiddenPicture(): boolean {
    const h = this.hide
    if (!h?.pictures.length || this.formDepth !== 0) return false
    const [x, y] = apply(mul(this.state.ctm, this.base), 0.5, 0.5)
    return inBox(h.pictures, x / h.width, y / h.height)
  }

  private async drawImage(img: PdfStream, res: PdfDict) {
    this.onImage?.(img, this.state.ctm)
    if (this.hiddenPicture()) return
    if (this.analysis) return this.paintRaster('unsupported')
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
    const image = new PdfStream(dict, d.subarray(start, dataEnd))
    this.onImage?.(image, this.state.ctm, true)
    if (this.hiddenPicture()) return
    if (this.analysis) return this.paintRaster('unsupported')
    this.paintRaster(await rasterizeImage({ doc: this.doc, platform: this.platform, resources: res, fill: this.state.fill.rgb, warn: (m) => this.warn(m) }, image))
  }

  // ---------- annotations ----------

  /** draw each annotation's normal appearance stream into its rectangle (ISO 32000-1 algorithm 8.1) */
  async annotations(page: Page, fields = true) {
    const annots = this.doc.resolve(page.dict.get('Annots'))
    if (!Array.isArray(annots)) return
    for (const ref of annots) {
      const a = this.doc.resolve(ref)
      if (!isDict(a)) continue
      if (!fields && isName(this.doc.resolve(a.get('Subtype')), 'Widget')) continue
      if (!isVisibleAnnotation(this.doc, a)) continue
      const normal = normalAppearance(this.doc, a)
      const matrix = normal && appearanceMatrix(this.doc, a, normal)
      if (!normal || !matrix) continue
      this.ctx.save()
      try {
        this.reset(matrix)
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
