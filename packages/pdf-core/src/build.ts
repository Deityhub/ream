// Drawing a new PDF page by page: text in the standard fonts (or one embedded TrueType font), rectangles, lines, clipping
// and pictures. Used by the tools that turn other formats into PDF. Coordinates are in points from the top left, y down.
import { PdfRef, PdfStream, PdfString, name, type PdfObj } from './objects.ts'
import { encodeTextString } from './info.ts'
import { PdfBuilder } from './writer.ts'
import { PdfRangeError } from './errors.ts'
import { deflate } from './flate.ts'
import { ascii } from './bytes.ts'
import { addImage, type ImageInput } from './images.ts'
import { embeddedResource, encodeWinAnsi, fontResource, textWidth } from './text.ts'
import type { PreparedFont } from './ttf.ts'

export type Rgb = [number, number, number]

/** the standard fonts: sans is Helvetica, serif Times, mono Courier. 'custom' is the embedded font given to `buildPdf`. */
export type FontSpec = {
  family: 'sans' | 'serif' | 'mono' | 'custom'
  bold?: boolean
  italic?: boolean
  /** horizontal scale of the glyphs (1 = as the font is): stands in for a font that is narrower or wider than the standard one */
  scale?: number
}

const BASE: Record<'sans' | 'serif' | 'mono', [string, string, string, string]> = {
  sans: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
  serif: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
  mono: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
}

export const baseFontName = (f: FontSpec) => BASE[f.family === 'custom' ? 'sans' : f.family][(f.bold ? 1 : 0) + (f.italic ? 2 : 0)]

/**
 * Width of text in points. Helvetica and Courier use exact metrics. ponytail: Times is estimated from Helvetica's widths
 * (about 8% narrower), so right-aligned or centred serif text can be a little off; add the Times metrics if it matters.
 */
export function measure(text: string, size: number, font: FontSpec, embedded?: PreparedFont | null): number {
  const k = font.scale ?? 1
  if (font.family === 'custom' && embedded) return embedded.width(text, size) * k
  if (font.family === 'mono') return [...text].length * 0.6 * size * k
  const w = textWidth(text, size, { bold: font.bold }) * k
  return font.family === 'serif' ? w * 0.92 : w
}

/** a path: move, line, cubic curve, close */
export type Seg = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z']
export type PathStyle = { fill?: Rgb; /** 0..1 */ fillAlpha?: number; stroke?: Rgb; width?: number; dash?: number[] }

type Op =
  | { k: 'save' }
  | { k: 'restore' }
  | { k: 'clip'; x: number; y: number; w: number; h: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill: Rgb }
  | { k: 'line'; x0: number; y0: number; x1: number; y1: number; width: number; color: Rgb; dash?: number[] }
  | { k: 'text'; x: number; y: number; s: string; font: FontSpec; size: number; color: Rgb }
  | { k: 'image'; id: number; x: number; y: number; w: number; h: number }
  | { k: 'path'; segs: Seg[]; style: PathStyle }
  | { k: 'rotate'; deg: number; cx: number; cy: number }

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
  fillRect(x: number, y: number, w: number, h: number, fill: Rgb) { this.ops.push({ k: 'rect', x, y, w, h, fill }) }
  line(x0: number, y0: number, x1: number, y1: number, width: number, color: Rgb, dash?: number[]) { this.ops.push({ k: 'line', x0, y0, x1, y1, width, color, dash }) }
  /** `y` is the baseline */
  text(x: number, y: number, s: string, font: FontSpec, size: number, color: Rgb) { if (s) this.ops.push({ k: 'text', x, y, s, font, size, color }) }
  image(id: number, x: number, y: number, w: number, h: number) { this.ops.push({ k: 'image', id, x, y, w, h }) }
  /** draw a path, filled and/or stroked */
  path(segs: Seg[], style: PathStyle) { if (segs.length && (style.fill || style.stroke)) this.ops.push({ k: 'path', segs, style }) }
  /** turn what follows by `deg` clockwise about (cx, cy), until the matching `restore`; call it right after `save` */
  rotate(deg: number, cx: number, cy: number) { if (deg) this.ops.push({ k: 'rotate', deg, cx, cy }) }
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
  /** every text drawn in the custom font, for cutting the font down to the glyphs used */
  customText(): string {
    return this.pages.flatMap((p) => p.ops.flatMap((o) => (o.k === 'text' && o.font.family === 'custom' ? [o.s] : []))).join('')
  }
}

const n = (v: number) => String(Math.round(v * 1000) / 1000)
const color = (c: Rgb) => c.map((v) => n(Math.min(255, Math.max(0, v)) / 255)).join(' ')
const hex = (codes: number[]) => '<' + codes.map((c) => c.toString(16).padStart(2, '0')).join('') + '>'

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

function content(page: PageDraw, embedded: PreparedFont | null, lost: Set<string>, alphas: Map<number, string>): string {
  const H = page.height
  let depth = 0
  const out: string[] = []
  for (const o of page.ops) {
    if (o.k === 'save') { out.push('q'); depth++ }
    else if (o.k === 'restore') { if (depth) { out.push('Q'); depth-- } }
    else if (o.k === 'clip') out.push(`${n(o.x)} ${n(H - o.y - o.h)} ${n(o.w)} ${n(o.h)} re W n`)
    else if (o.k === 'rect') out.push(`${color(o.fill)} rg ${n(o.x)} ${n(H - o.y - o.h)} ${n(o.w)} ${n(o.h)} re f`)
    else if (o.k === 'line') out.push(`q ${color(o.color)} RG ${n(o.width)} w${o.dash ? ` [${o.dash.map(n).join(' ')}] 0 d` : ''} ${n(o.x0)} ${n(H - o.y0)} m ${n(o.x1)} ${n(H - o.y1)} l S Q`)
    else if (o.k === 'rotate') {
      // turning clockwise on a page that is y down is counter-clockwise in PDF's y-up space with the angle negated
      const a = (o.deg * Math.PI) / 180
      const [c, s] = [Math.cos(a), Math.sin(a)]
      const py = H - o.cy
      out.push(`${n(c)} ${n(-s)} ${n(s)} ${n(c)} ${n(o.cx - c * o.cx - s * py)} ${n(py + s * o.cx - c * py)} cm`)
    } else if (o.k === 'path') {
      const { style: st } = o
      let g = ''
      if (st.fill && st.fillAlpha !== undefined && st.fillAlpha < 1) {
        const key = Math.round(st.fillAlpha * 100) / 100
        if (!alphas.has(key)) alphas.set(key, `Ream${alphas.size}`)
        g = `/${alphas.get(key)} gs `
      }
      const d = o.segs.map((sg) => (sg[0] === 'Z' ? 'h' : sg[0] === 'C' ? `${n(sg[1])} ${n(H - sg[2])} ${n(sg[3])} ${n(H - sg[4])} ${n(sg[5])} ${n(H - sg[6])} c` : `${n(sg[1])} ${n(H - sg[2])} ${sg[0] === 'M' ? 'm' : 'l'}`)).join(' ')
      const paint = st.fill && st.stroke ? 'B' : st.fill ? 'f' : 'S'
      out.push(`q ${g}${st.fill ? `${color(st.fill)} rg ` : ''}${st.stroke ? `${color(st.stroke)} RG ${n(st.width ?? 1)} w${st.dash ? ` [${st.dash.map(n).join(' ')}] 0 d` : ''} ` : ''}${d} ${paint} Q`)
    } else if (o.k === 'image') out.push(`q ${n(o.w)} 0 0 ${n(o.h)} ${n(o.x)} ${n(H - o.y - o.h)} cm /Im${o.id} Do Q`)
    else {
      const custom = o.font.family === 'custom' && embedded
      const res = custom ? embeddedResource('C') : fontResource(baseFontName(o.font))
      out.push(`BT /${res} ${n(o.size)} Tf ${n((o.font.scale ?? 1) * 100)} Tz ${color(o.color)} rg ${n(o.x)} ${n(H - o.y)} Td ${custom ? embedded.encode(o.s) : winText(o.s, lost)} Tj ET`)
    }
  }
  while (depth--) out.push('Q')
  return out.join('\n') + '\n'
}

/**
 * The PDF for a drawing. `embedded` is a font from `prepareFont` for text drawn with family 'custom' (prepare it with
 * `drawing.customText()`). `lost` lists characters the standard fonts could not show; they appear as "?".
 */
export async function buildPdf(d: PdfDrawing, embedded: PreparedFont | null = null): Promise<{ bytes: Uint8Array; lost: string[] }> {
  if (!d.pages.length) throw new PdfRangeError('There is nothing to put in the PDF.')
  const b = new PdfBuilder()
  const catalog = b.reserve()
  const pagesRef = b.reserve()
  const lost = new Set<string>()
  const fonts = new Map<string, PdfRef>()
  const fontFor = (base: string) => {
    let r = fonts.get(base)
    if (!r) fonts.set(base, (r = b.add(new Map<string, PdfObj>([['Type', name('Font')], ['Subtype', name('Type1')], ['BaseFont', name(base)], ['Encoding', name('WinAnsiEncoding')]]))))
    return r
  }
  const embeddedRef = embedded ? embedded.write(b) : null
  const imageRefs: PdfRef[] = []
  for (const img of d.images) imageRefs.push(await addImage(b, img))
  const kids: PdfRef[] = []
  for (const p of d.pages) {
    const alphas = new Map<number, string>()
    const text = content(p, embedded, lost, alphas)
    const used = new Set<string>()
    for (const o of p.ops) if (o.k === 'text' && !(o.font.family === 'custom' && embedded)) used.add(baseFontName(o.font))
    const images = new Set(p.ops.flatMap((o) => (o.k === 'image' ? [o.id] : [])))
    const res = new Map<string, PdfObj>()
    const fontDict = new Map<string, PdfObj>([...used].map((u) => [fontResource(u), fontFor(u)]))
    if (embeddedRef && p.ops.some((o) => o.k === 'text' && o.font.family === 'custom')) fontDict.set(embeddedResource('C'), embeddedRef)
    if (fontDict.size) res.set('Font', fontDict)
    if (alphas.size) res.set('ExtGState', new Map<string, PdfObj>([...alphas].map(([a, nm]) => [nm, new Map<string, PdfObj>([['Type', name('ExtGState')], ['ca', a]])])))
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
