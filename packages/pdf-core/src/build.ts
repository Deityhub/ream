// Drawing a new PDF page by page: text (standard fonts or embedded TrueType faces), shapes with solid or gradient fills,
// lines, clipping, transforms, opacity and pictures. Used by the tools that turn other formats into PDF. Coordinates are
// in points from the top left, y down.
import { PdfRef, PdfStream, PdfString, name, type PdfObj } from './objects.ts'
import { encodeTextString } from './info.ts'
import { PdfBuilder } from './writer.ts'
import { PdfRangeError } from './errors.ts'
import { deflate } from './flate.ts'
import { ascii } from './bytes.ts'
import { addImage, type ImageInput } from './images.ts'
import { encodeWinAnsi, fontResource, textWidth } from './text.ts'
import { prepareFont, type PreparedFont, type TtfFont } from './ttf.ts'

export type Rgb = [number, number, number]

/**
 * A typeface to embed: one or more TrueType fonts that together cover the letters (web fonts come split by script).
 * A letter none of them has is drawn in the standard `fallback` font, or as "?" when that has none either.
 */
export class FontFace {
  parts: TtfFont[]
  fallback: 'sans' | 'serif' | 'mono'
  constructor(parts: TtfFont[], fallback: 'sans' | 'serif' | 'mono' = 'sans') {
    this.parts = parts
    this.fallback = fallback
  }
  /** the part that has a glyph for this character, or -1 */
  partFor(cp: number): number {
    for (let i = 0; i < this.parts.length; i++) if (this.parts[i].glyphFor(cp)) return i
    return -1
  }
}

/** the standard fonts: sans is Helvetica, serif Times, mono Courier. With `face`, the text is drawn in that embedded typeface. */
export type FontSpec = {
  family: 'sans' | 'serif' | 'mono'
  face?: FontFace
  bold?: boolean
  italic?: boolean
  /** horizontal scale of the glyphs (1 = as the font is): stands in for a font that is narrower or wider than the standard one */
  scale?: number
  /** the family the document asked for, when `face` stands in for it: kept with the font (/ReamFamily) so a conversion back can name it */
  name?: string
}

const BASE: Record<'sans' | 'serif' | 'mono', [string, string, string, string]> = {
  sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
}

export const baseFontName = (f: FontSpec) => BASE[f.face ? f.face.fallback : f.family][(f.bold ? 1 : 0) + (f.italic ? 2 : 0)]

/** width of text in the standard font of `family`. ponytail: Times is estimated from Helvetica (about 8% narrower). */
function standardWidth(text: string, size: number, family: 'sans' | 'serif' | 'mono', bold?: boolean): number {
  if (family === 'mono') return [...text].length * 0.6 * size
  const w = textWidth(text, size, { bold })
  return family === 'serif' ? w * 0.92 : w
}

/** a string cut into runs that one font draws: a part of the face (index), or -1 for the standard font */
function runsOf(s: string, face: FontFace): { part: number; text: string }[] {
  const out: { part: number; text: string }[] = []
  for (const ch of s.normalize('NFC')) {
    const cp = ch.codePointAt(0)!
    // a space or control takes whatever font the text around it uses
    const part = cp <= 32 && out.length ? out[out.length - 1].part : face.partFor(cp)
    const last = out[out.length - 1]
    if (last && last.part === part) last.text += ch
    else out.push({ part, text: ch })
  }
  return out
}

/** width of text in points, in the font it will be drawn with */
export function measure(text: string, size: number, font: FontSpec): number {
  const k = font.scale ?? 1
  if (!font.face) return standardWidth(text, size, font.family, font.bold) * k
  let w = 0
  for (const r of runsOf(text, font.face)) {
    if (r.part < 0) w += standardWidth(r.text, size, font.face.fallback, font.bold)
    else {
      const t = font.face.parts[r.part]
      for (const ch of r.text) w += (t.advance(t.glyphFor(ch.codePointAt(0)!)) * size) / t.unitsPerEm
    }
  }
  return w * k
}

/** a path: move, line, cubic curve, close */
export type Seg = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z']

/** a gradient over the box of the path it fills. `angle` (linear) is in degrees, clockwise from left to right; radial grows from (cx, cy), shares of the box */
export type Gradient =
  | { type: 'linear'; stops: { at: number; color: Rgb }[]; angle: number }
  | { type: 'radial'; stops: { at: number; color: Rgb }[]; cx: number; cy: number }

export type PathStyle = {
  fill?: Rgb | Gradient
  /** 0..1 */
  fillAlpha?: number
  stroke?: Rgb
  strokeAlpha?: number
  width?: number
  dash?: number[]
  /** even-odd filling (holes in a donut); default non-zero */
  evenOdd?: boolean
}

type Op =
  | { k: 'save' }
  | { k: 'restore' }
  | { k: 'clip'; x: number; y: number; w: number; h: number }
  | { k: 'clipPath'; segs: Seg[]; evenOdd: boolean }
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill: Rgb }
  | { k: 'line'; x0: number; y0: number; x1: number; y1: number; width: number; color: Rgb; dash?: number[]; alpha?: number }
  | { k: 'text'; x: number; y: number; s: string; font: FontSpec; size: number; color: Rgb; alpha?: number; spacing?: number }
  | { k: 'image'; id: number; x: number; y: number; w: number; h: number; alpha?: number }
  | { k: 'path'; segs: Seg[]; style: PathStyle }
  | { k: 'transform'; m: [number, number, number, number, number, number] }

export class PageDraw {
  ops: Op[] = []
  width: number
  height: number
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
  save() { this.ops.push({ k: 'save' }) }
  restore() { this.ops.push({ k: 'restore' }) }
  /** limit what follows to this box, until the matching `restore` */
  clip(x: number, y: number, w: number, h: number) { this.ops.push({ k: 'clip', x, y, w, h }) }
  /** limit what follows to the inside of a path, until the matching `restore` */
  clipPath(segs: Seg[], evenOdd = false) { if (segs.length) this.ops.push({ k: 'clipPath', segs, evenOdd }) }
  fillRect(x: number, y: number, w: number, h: number, fill: Rgb) { this.ops.push({ k: 'rect', x, y, w, h, fill }) }
  line(x0: number, y0: number, x1: number, y1: number, width: number, color: Rgb, dash?: number[], alpha?: number) { this.ops.push({ k: 'line', x0, y0, x1, y1, width, color, dash, alpha }) }
  /** `y` is the baseline */
  /** `spacing` is extra space after every letter, points (it is not in `measure`: add it per letter) */
  text(x: number, y: number, s: string, font: FontSpec, size: number, color: Rgb, alpha?: number, spacing?: number) { if (s) this.ops.push({ k: 'text', x, y, s, font, size, color, alpha, spacing }) }
  image(id: number, x: number, y: number, w: number, h: number, alpha?: number) { this.ops.push({ k: 'image', id, x, y, w, h, alpha }) }
  /** draw a path, filled and/or stroked */
  path(segs: Seg[], style: PathStyle) { if (segs.length && (style.fill || style.stroke)) this.ops.push({ k: 'path', segs, style }) }
  /**
   * Change the coordinates of what follows, until the matching `restore` (call it right after `save`). The matrix maps the
   * page's own y-down points: x' = a x + c y + e, y' = b x + d y + f.
   */
  transform(a: number, b: number, c: number, d: number, e: number, f: number) { this.ops.push({ k: 'transform', m: [a, b, c, d, e, f] }) }
  /** turn what follows by `deg` clockwise about (cx, cy), until the matching `restore`; call it right after `save` */
  rotate(deg: number, cx: number, cy: number) {
    if (!deg) return
    const r = (deg * Math.PI) / 180
    const [c, s] = [Math.cos(r), Math.sin(r)]
    this.transform(c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy)
  }
  /** mirror what follows left to right and/or top to bottom about (cx, cy) */
  flip(horizontal: boolean, vertical: boolean, cx: number, cy: number) {
    if (horizontal || vertical) this.transform(horizontal ? -1 : 1, 0, 0, vertical ? -1 : 1, horizontal ? 2 * cx : 0, vertical ? 2 * cy : 0)
  }
}

export class PdfDrawing {
  pages: PageDraw[] = []
  images: ImageInput[] = []
  title = ''
  addPage(width: number, height: number): PageDraw {
    if (!(width > 0 && height > 0 && width <= 14400 && height <= 14400)) throw new PdfRangeError('That page size is not valid.')
    const p = new PageDraw(width, height)
    this.pages.push(p)
    return p
  }
  /** register a picture; the returned number goes to `PageDraw.image`. The same picture can be drawn on many pages. */
  addImage(img: ImageInput): number {
    this.images.push(img)
    return this.images.length - 1
  }
}

const n = (v: number) => String(Math.round(v * 1000) / 1000)
const color = (c: Rgb) => c.map((v) => n(Math.min(255, Math.max(0, v)) / 255)).join(' ')
const hex = (codes: number[]) => '<' + codes.map((c) => c.toString(16).padStart(2, '0')).join('') + '>'
const isGradient = (f: PathStyle['fill']): f is Gradient => !!f && !Array.isArray(f)

/** WinAnsi text for a content stream; characters the standard fonts lack become "?" and are collected in `lost` */
function winText(s: string, lost: Set<string>): string {
  const codes: number[] = []
  for (const ch of s.normalize('NFC')) {
    try {
      codes.push(...encodeWinAnsi(ch))
    } catch {
      lost.add(ch)
      codes.push(63)
    }
  }
  return hex(codes)
}

/** what a page's content asks the resources for */
type PageRes = { alphas: Map<string, [number, number]>; shadings: PdfObj[]; std: Set<string>; parts: Set<string> }

/** an embedded font resource: one part of a face, for one family the document asked for */
const partIds = new WeakMap<TtfFont, number>()
let nextPart = 0
const keyOf = (part: TtfFont, asked?: string) => {
  if (!partIds.has(part)) partIds.set(part, nextPart++)
  return `${partIds.get(part)}|${asked ?? ''}`
}

/** a shading for a gradient over a box given in PDF space (x0, y0 bottom-left, x1, y1 top-right) */
function shading(g: Gradient, x0: number, y0: number, x1: number, y1: number): PdfObj {
  const stops = [...g.stops].sort((a, b) => a.at - b.at)
  if (stops.length === 1) stops.push({ ...stops[0], at: 1 })
  if (stops[0].at > 0) stops.unshift({ ...stops[0], at: 0 })
  if (stops[stops.length - 1].at < 1) stops.push({ ...stops[stops.length - 1], at: 1 })
  const c = (rgb: Rgb) => rgb.map((v) => Math.round((Math.min(255, Math.max(0, v)) / 255) * 1000) / 1000)
  const pieces = stops.slice(1).map((s, i) => new Map<string, PdfObj>([['FunctionType', 2], ['Domain', [0, 1]], ['C0', c(stops[i].color)], ['C1', c(s.color)], ['N', 1]]))
  const fn = pieces.length === 1 ? pieces[0] : new Map<string, PdfObj>([['FunctionType', 3], ['Domain', [0, 1]], ['Functions', pieces], ['Bounds', stops.slice(1, -1).map((s) => Math.round(s.at * 1000) / 1000)], ['Encode', pieces.flatMap(() => [0, 1])]])
  const [cx, cy, w, h] = [(x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0]
  if (g.type === 'radial') {
    const px = x0 + g.cx * w
    const py = y1 - g.cy * h
    const r = Math.max(...[[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => Math.hypot(x - px, y - py)))
    return new Map<string, PdfObj>([['ShadingType', 3], ['ColorSpace', name('DeviceRGB')], ['Coords', [px, py, 0, px, py, r].map((v) => Math.round(v * 100) / 100)], ['Function', fn], ['Extend', [true, true]]])
  }
  // the line through the middle at the angle, long enough that its ends touch the box's far corners (y flipped: clockwise on the page)
  const a = (g.angle * Math.PI) / 180
  const [dx, dy] = [Math.cos(a), -Math.sin(a)]
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
  const coords = [cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half].map((v) => Math.round(v * 100) / 100)
  return new Map<string, PdfObj>([['ShadingType', 2], ['ColorSpace', name('DeviceRGB')], ['Coords', coords], ['Function', fn], ['Extend', [true, true]]])
}

function content(page: PageDraw, lost: Set<string>, res: PageRes, prepared: Map<string, PreparedFont>, resName: Map<string, string>): string {
  const H = page.height
  let depth = 0
  const out: string[] = []
  const gs = (fill?: number, stroke?: number) => {
    const f = fill === undefined || fill >= 1 ? 1 : Math.round(fill * 100) / 100
    const s = stroke === undefined || stroke >= 1 ? 1 : Math.round(stroke * 100) / 100
    if (f === 1 && s === 1) return ''
    const key = `${f}/${s}`
    if (!res.alphas.has(key)) res.alphas.set(key, [f, s])
    return `/A${[...res.alphas.keys()].indexOf(key)} gs `
  }
  const pathOps = (segs: Seg[]) => segs.map((sg) => (sg[0] === 'Z' ? 'h' : sg[0] === 'C' ? `${n(sg[1])} ${n(H - sg[2])} ${n(sg[3])} ${n(H - sg[4])} ${n(sg[5])} ${n(H - sg[6])} c` : `${n(sg[1])} ${n(H - sg[2])} ${sg[0] === 'M' ? 'm' : 'l'}`)).join(' ')
  for (const o of page.ops) {
    if (o.k === 'save') { out.push('q'); depth++ }
    else if (o.k === 'restore') { if (depth) { out.push('Q'); depth-- } }
    else if (o.k === 'clip') out.push(`${n(o.x)} ${n(H - o.y - o.h)} ${n(o.w)} ${n(o.h)} re W n`)
    else if (o.k === 'clipPath') out.push(`${pathOps(o.segs)} W${o.evenOdd ? '*' : ''} n`)
    else if (o.k === 'rect') out.push(`${color(o.fill)} rg ${n(o.x)} ${n(H - o.y - o.h)} ${n(o.w)} ${n(o.h)} re f`)
    else if (o.k === 'line') out.push(`q ${gs(undefined, o.alpha)}${color(o.color)} RG ${n(o.width)} w${o.dash ? ` [${o.dash.map(n).join(' ')}] 0 d` : ''} ${n(o.x0)} ${n(H - o.y0)} m ${n(o.x1)} ${n(H - o.y1)} l S Q`)
    else if (o.k === 'transform') {
      // the y-down matrix, seen in PDF's y-up space (conjugated by the flip y -> H - y)
      const [a, b, c, d, e, f] = o.m
      out.push(`${n(a)} ${n(-b)} ${n(-c)} ${n(d)} ${n(c * H + e)} ${n(H - d * H - f)} cm`)
    } else if (o.k === 'path') {
      const { style: st } = o
      const d = pathOps(o.segs)
      const rule = st.evenOdd ? '*' : ''
      if (isGradient(st.fill)) {
        // a gradient fills the path's box clipped to the path; the line, if any, goes over it
        const xs = o.segs.flatMap((s) => (s[0] === 'Z' ? [] : s[0] === 'C' ? [s[1], s[3], s[5]] : [s[1]]))
        const ys = o.segs.flatMap((s) => (s[0] === 'Z' ? [] : s[0] === 'C' ? [s[2], s[4], s[6]] : [s[2]]))
        res.shadings.push(shading(st.fill, Math.min(...xs), H - Math.max(...ys), Math.max(...xs), H - Math.min(...ys)))
        out.push(`q ${gs(st.fillAlpha)}${d} W${rule} n /Sh${res.shadings.length - 1} sh Q`)
        if (st.stroke) out.push(`q ${gs(undefined, st.strokeAlpha)}${color(st.stroke)} RG ${n(st.width ?? 1)} w${st.dash ? ` [${st.dash.map(n).join(' ')}] 0 d` : ''} ${d} S Q`)
        continue
      }
      const paint = st.fill && st.stroke ? `B${rule}` : st.fill ? `f${rule}` : 'S'
      out.push(`q ${gs(st.fill ? st.fillAlpha : undefined, st.stroke ? st.strokeAlpha : undefined)}${st.fill ? `${color(st.fill)} rg ` : ''}${st.stroke ? `${color(st.stroke)} RG ${n(st.width ?? 1)} w${st.dash ? ` [${st.dash.map(n).join(' ')}] 0 d` : ''} ` : ''}${d} ${paint} Q`)
    } else if (o.k === 'image') out.push(`q ${gs(o.alpha)}${n(o.w)} 0 0 ${n(o.h)} ${n(o.x)} ${n(H - o.y - o.h)} cm /Im${o.id} Do Q`)
    else {
      // character spacing is scaled by Tz like the glyphs, so it is divided back out; both are set every time because they
      // belong to the graphics state and would otherwise carry over to the next text
      const head = `BT ${gs(o.alpha)}${n((o.font.scale ?? 1) * 100)} Tz ${n((o.spacing ?? 0) / (o.font.scale ?? 1))} Tc ${color(o.color)} rg ${n(o.x)} ${n(H - o.y)} Td`
      const shows: string[] = []
      const runs = o.font.face ? runsOf(o.s, o.font.face) : [{ part: -1, text: o.s }]
      for (const r of runs) {
        if (r.part < 0) {
          const base = baseFontName(o.font)
          res.std.add(base)
          shows.push(`/${fontResource(base)} ${n(o.size)} Tf ${winText(r.text, lost)} Tj`)
        } else {
          const key = keyOf(o.font.face!.parts[r.part], o.font.name)
          res.parts.add(key)
          shows.push(`/${resName.get(key)} ${n(o.size)} Tf ${prepared.get(key)!.encode(r.text)} Tj`)
        }
      }
      out.push(`${head} ${shows.join(' ')} ET`)
    }
  }
  while (depth--) out.push('Q')
  return out.join('\n') + '\n'
}

/**
 * The PDF for a drawing. Embedded faces are cut down to the letters drawn with them. `lost` lists characters no font
 * could show; they appear as "?".
 */
export async function buildPdf(d: PdfDrawing): Promise<{ bytes: Uint8Array; lost: string[] }> {
  if (!d.pages.length) throw new PdfRangeError('There is nothing to put in the PDF.')
  // first the text each embedded font draws, so each can be cut down once for the whole file
  // a part standing in for two families the document named is embedded once for each, so each keeps its family's name
  const textOf = new Map<string, { font: TtfFont; asked?: string; text: string }>()
  for (const p of d.pages) {
    for (const o of p.ops) {
      if (o.k !== 'text' || !o.font.face) continue
      for (const r of runsOf(o.s, o.font.face)) {
        if (r.part < 0) continue
        const font = o.font.face.parts[r.part]
        const key = keyOf(font, o.font.name)
        const got = textOf.get(key) ?? textOf.set(key, { font, asked: o.font.name, text: '' }).get(key)!
        got.text += r.text
      }
    }
  }
  const prepared = new Map<string, PreparedFont>()
  const resName = new Map<string, string>()
  const asked = new Map<string, string | undefined>()
  for (const [key, { font, text, asked: a }] of textOf) {
    prepared.set(key, await prepareFont(font, [...new Set(text)].join('')))
    resName.set(key, `ReamF${resName.size}`)
    asked.set(key, a)
  }
  const b = new PdfBuilder()
  const catalog = b.reserve()
  const pagesRef = b.reserve()
  const lost = new Set<string>()
  const std = new Map<string, PdfRef>()
  const stdFor = (base: string) => {
    let r = std.get(base)
    if (!r) std.set(base, (r = b.add(new Map<string, PdfObj>([['Type', name('Font')], ['Subtype', name('Type1')], ['BaseFont', name(base)], ['Encoding', name('WinAnsiEncoding')]]))))
    return r
  }
  const embeddedRefs = new Map<string, PdfRef>()
  for (const [key, p] of prepared) {
    const a = asked.get(key)
    embeddedRefs.set(key, p.write(b, a ? new Map<string, PdfObj>([['ReamFamily', encodeTextString(a)]]) : undefined))
  }
  const imageRefs: PdfRef[] = []
  for (const img of d.images) imageRefs.push(await addImage(b, img))
  const kids: PdfRef[] = []
  for (const p of d.pages) {
    const pr: PageRes = { alphas: new Map(), shadings: [], std: new Set(), parts: new Set() }
    const text = content(p, lost, pr, prepared, resName)
    const images = new Set(p.ops.flatMap((o) => (o.k === 'image' ? [o.id] : [])))
    const res = new Map<string, PdfObj>()
    const fontDict = new Map<string, PdfObj>([...pr.std].map((u) => [fontResource(u), stdFor(u)]))
    for (const key of pr.parts) fontDict.set(resName.get(key)!, embeddedRefs.get(key)!)
    if (fontDict.size) res.set('Font', fontDict)
    if (pr.alphas.size) res.set('ExtGState', new Map<string, PdfObj>([...pr.alphas.values()].map(([f, s], i) => [`A${i}`, new Map<string, PdfObj>([['Type', name('ExtGState')], ['ca', f], ['CA', s]])])))
    if (pr.shadings.length) res.set('Shading', new Map<string, PdfObj>(pr.shadings.map((sh, i) => [`Sh${i}`, sh])))
    if (images.size) res.set('XObject', new Map<string, PdfObj>([...images].map((i) => [`Im${i}`, imageRefs[i]])))
    const stream = b.add(new PdfStream(new Map<string, PdfObj>([['Filter', name('FlateDecode')]]), await deflate(ascii(text))))
    kids.push(b.add(new Map<string, PdfObj>([['Type', name('Page')], ['Parent', pagesRef], ['MediaBox', [0, 0, p.width, p.height]], ['Contents', stream], ['Resources', res]])))
  }
  b.set(pagesRef, new Map<string, PdfObj>([['Type', name('Pages')], ['Kids', kids], ['Count', kids.length]]))
  b.set(catalog, new Map<string, PdfObj>([['Type', name('Catalog')], ['Pages', pagesRef]]))
  const info = new Map<string, PdfObj>([['Producer', new PdfString(ascii('Ream'))]])
  if (d.title) info.set('Title', encodeTextString(d.title))
  return { bytes: b.serialize(catalog, b.add(info)), lost: [...lost] }
}
