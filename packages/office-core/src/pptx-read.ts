// Read a presentation (.pptx) into a Deck with everything resolved: positions in points, the fills, lines, colours, fonts
// and sizes each shape and paragraph ends up with after the slide, its layout, its master and that master's theme have had
// their say, and master and layout shapes folded in under each slide's own. SmartArt is read from the drawing PowerPoint
// stores with it. Charts are read from the values they keep (chart-read.ts). Not read: embedded objects (left to the caller as marked gaps), animations, notes, shadows
// and other effects.
import { UserError, unzip } from '@ream/core'
import { resolveColor, type ColorContext } from './drawingml.ts'
import { readChart } from './chart-read.ts'
import { boxGuides, evalGuide } from './geom-formula.ts'
import { DEFAULT_THEME, readRels, readTheme, relsOf, type Theme } from './ooxml.ts'
import type { CustomPath, Deck, LineEnd, Paint, Slide, SlideBox, SlidePara, SlideRun, SlideShape, SlideTable, SlideTableCell, Stroke, Xform } from './pptx-model.ts'
import { child, dig, kids, num, parseXml, type XmlNode } from './xml.ts'

const EMU = 12700

/** the table styles PowerPoint knows by number and does not always write into the file; the default for new tables is Medium Style 2 */
const line = (n: string, w: number, color: string) => `<a:${n}><a:ln w="${w}"><a:solidFill><a:schemeClr val="${color}"/></a:solidFill></a:ln></a:${n}>`
const BUILTIN_TABLE_STYLES: Record<string, XmlNode> = {
  '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': parseXml(
    `<tblStyle styleId="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"><wholeTbl><tcTxStyle><fontRef idx="minor"/><schemeClr val="dk1"/></tcTxStyle><tcStyle><tcBdr>${['left', 'right', 'top', 'bottom', 'insideH', 'insideV'].map((n) => line(n, 12700, 'lt1')).join('')}</tcBdr><fill><solidFill><schemeClr val="accent1"><tint val="20000"/></schemeClr></solidFill></fill></tcStyle></wholeTbl><band1H><tcStyle><tcBdr/><fill><solidFill><schemeClr val="accent1"><tint val="40000"/></schemeClr></solidFill></fill></tcStyle></band1H><firstRow><tcTxStyle b="on"><fontRef idx="minor"/><schemeClr val="lt1"/></tcTxStyle><tcStyle><tcBdr>${line('bottom', 38100, 'lt1')}</tcBdr><fill><solidFill><schemeClr val="accent1"/></solidFill></fill></tcStyle></firstRow><lastRow><tcTxStyle b="on"><fontRef idx="minor"/><schemeClr val="lt1"/></tcTxStyle><tcStyle><tcBdr>${line('top', 38100, 'lt1')}</tcBdr><fill><solidFill><schemeClr val="accent1"/></solidFill></fill></tcStyle></lastRow><firstCol><tcTxStyle b="on"><fontRef idx="minor"/><schemeClr val="lt1"/></tcTxStyle><tcStyle><tcBdr/><fill><solidFill><schemeClr val="accent1"/></solidFill></fill></tcStyle></firstCol></tblStyle>`,
  ),
  '{5940675A-B579-460E-94D1-54222C63F5DA}': parseXml(`<tblStyle styleId="{5940675A-B579-460E-94D1-54222C63F5DA}"><wholeTbl><tcTxStyle><fontRef idx="minor"/><schemeClr val="tx1"/></tcTxStyle><tcStyle><tcBdr>${['left', 'right', 'top', 'bottom', 'insideH', 'insideV'].map((n) => line(n, 12700, 'tx1')).join('')}</tcBdr></tcStyle></wholeTbl></tblStyle>`),
}
const pt = (v: number) => v / EMU
const on = (v: string | undefined) => v === '1' || v === 'true' || v === 'on'
const MAX_SHAPES = 20000
const SHAPES = ['sp', 'pic', 'cxnSp', 'grpSp', 'graphicFrame']

type Rel = { part: string; type: string; external: boolean }
type Chain = (XmlNode | undefined)[]

/** a master with what hangs off it: its theme and colour map, its text styles */
type Master = { part: Part; theme: Theme; themePart?: Part; clrMap: Record<string, string>; styles: { title?: XmlNode; body?: XmlNode; other?: XmlNode } }

type Env = {
  xml: (name: string) => XmlNode | undefined
  bytes: (name: string) => Uint8Array | undefined
  defaultText?: XmlNode
  tableStyles: Map<string, XmlNode>
  budget: { shapes: number }
}

/** a part of the package: its XML and its relationships */
type Part = { name: string; root: XmlNode; rels: Map<string, Rel> }

type Xf = { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }

const xfrmOf = (spPr: XmlNode | undefined): Xf | undefined => {
  const x = child(spPr, 'xfrm') ?? (spPr?.name === 'xfrm' ? spPr : undefined)
  const off = child(x, 'off')
  const ext = child(x, 'ext')
  if (!off || !ext) return undefined
  return { x: pt(num(off, 'x')), y: pt(num(off, 'y')), w: pt(num(ext, 'cx')), h: pt(num(ext, 'cy')), rot: num(x, 'rot') / 60000, flipH: on(x!.attrs.flipH), flipV: on(x!.attrs.flipV) }
}

// ---------- matrices: groups scale, move, turn and mirror what is in them ----------

type M = Xform
const IDENT: M = [1, 0, 0, 1, 0, 0]
/** first a, then b */
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
/** turn by deg clockwise and mirror about the centre of a box */
function turnAbout(deg: number, flipH: boolean, flipV: boolean, cx: number, cy: number): M {
  const r = (deg * Math.PI) / 180
  const [c, s] = [Math.cos(r), Math.sin(r)]
  const toO: M = [1, 0, 0, 1, -cx, -cy]
  const flip: M = [flipH ? -1 : 1, 0, 0, flipV ? -1 : 1, 0, 0]
  const turn: M = [c, s, -s, c, 0, 0]
  return mul(mul(mul(toO, flip), turn), [1, 0, 0, 1, cx, cy])
}
/** a matrix that only scales and moves (or is the identity) can be applied to a box; anything else is kept as the shape's xform */
const simple = (m: M) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[0] > 0 && m[3] > 0

// ---------- placeholders ----------

const phOf = (sp: XmlNode) => dig(sp, 'nvSpPr', 'nvPr', 'ph') ?? dig(sp, 'nvPicPr', 'nvPr', 'ph') ?? dig(sp, 'nvGraphicFramePr', 'nvPr', 'ph')
const normType = (t?: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t ?? 'body')

/**
 * The placeholder in a layout or master that a placeholder on a slide takes its place and type from. A layout's is found
 * by number, then type; a master's by type only, as PowerPoint does: numbers on a master are its own (a master's slide
 * number can share a number with a layout's content placeholder).
 */
function findPlaceholder(tree: XmlNode | undefined, ph: XmlNode, byIdx: boolean): XmlNode | undefined {
  const all = (tree?.children ?? []).filter((c) => c.name === 'sp' && phOf(c))
  const idx = ph.attrs.idx
  return (byIdx && idx !== undefined ? all.find((s) => phOf(s)!.attrs.idx === idx) : undefined) ?? all.find((s) => normType(phOf(s)!.attrs.type) === normType(ph.attrs.type))
}

// ---------- fills and lines ----------

const FILLS = ['solidFill', 'noFill', 'gradFill', 'pattFill', 'blipFill', 'grpFill']

function pictureKind(name: string): 'png' | 'jpeg' | 'other' {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext === 'png' ? 'png' : ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : 'other'
}

/** a fill element as a paint; null for noFill; undefined for none of them */
function paintOf(node: XmlNode | undefined, colors: ColorContext, rels: Map<string, Rel>, env: Env): Paint | null | undefined {
  if (!node) return undefined
  if (node.name === 'noFill') return null
  if (node.name === 'solidFill') {
    const c = resolveColor(node, colors)
    return c ? { type: 'solid', color: c.hex, alpha: c.alpha < 1 ? c.alpha : undefined } : undefined
  }
  if (node.name === 'gradFill') {
    const stops = kids(child(node, 'gsLst'), 'gs').flatMap((gs) => {
      const c = resolveColor(gs.children[0], colors)
      return c ? [{ at: Math.min(1, Math.max(0, num(gs, 'pos') / 100000)), color: c.hex, alpha: c.alpha < 1 ? c.alpha : undefined }] : []
    })
    if (!stops.length) return undefined
    const path = child(node, 'path')
    if (path) {
      const r = child(path, 'fillToRect')
      const cx = r ? (num(r, 'l') / 100000 + (1 - num(r, 'r') / 100000)) / 2 : 0.5
      const cy = r ? (num(r, 't') / 100000 + (1 - num(r, 'b') / 100000)) / 2 : 0.5
      return { type: 'gradient', stops, center: [cx, cy] }
    }
    return { type: 'gradient', stops, angle: num(child(node, 'lin'), 'ang') / 60000 }
  }
  if (node.name === 'blipFill') {
    const blip = child(node, 'blip')
    const rel = rels.get(blip?.attrs.embed ?? '')
    const data = rel ? env.bytes(rel.part) : undefined
    if (!rel || !data) return undefined
    const src = child(node, 'srcRect')
    const amt = child(blip, 'alphaModFix')
    return { type: 'picture', bytes: data, kind: pictureKind(rel.part), name: rel.part, crop: src && Object.keys(src.attrs).length ? [num(src, 'l') / 100000, num(src, 't') / 100000, num(src, 'r') / 100000, num(src, 'b') / 100000] : undefined, alpha: amt ? num(amt, 'amt', 100000) / 100000 : undefined }
  }
  // ponytail: a pattern is drawn as its foreground colour
  if (node.name === 'pattFill') {
    const c = resolveColor(child(node, 'fgClr'), colors)
    return c ? { type: 'solid', color: c.hex } : undefined
  }
  return undefined
}

/** what a style reference (fillRef, lnRef, bgRef) points at in the theme, with its colour as the placeholder colour */
function themeStyle(ref: XmlNode | undefined, list: XmlNode[], colors: ColorContext): { node?: XmlNode; colors: ColorContext } {
  const placeholder = resolveColor(ref?.children[0], colors)?.hex
  return { node: list[num(ref, 'idx') - 1], colors: { ...colors, placeholder } }
}

const DASH: Record<string, 'dash' | 'dot' | 'dashDot'> = { dash: 'dash', sysDash: 'dash', lgDash: 'dash', dot: 'dot', sysDot: 'dot', dashDot: 'dashDot', lgDashDot: 'dashDot', sysDashDot: 'dashDot', lgDashDotDot: 'dashDot', sysDashDotDot: 'dashDot' }
const END: Record<string, LineEnd> = { triangle: 'triangle', arrow: 'arrow', stealth: 'stealth', oval: 'oval', diamond: 'diamond' }

/** a line element (`a:ln`) as a stroke: its own colour, else the style's; null when it is switched off */
function strokeOf(ln: XmlNode | undefined, ref: XmlNode | undefined, master: Master, colors: ColorContext): Stroke | null {
  const fill = ln?.children.find((c) => ['solidFill', 'noFill', 'gradFill', 'pattFill'].includes(c.name))
  const style = ref && num(ref, 'idx') > 0 ? themeStyle(ref, master.theme.lineStyles, colors) : undefined
  let color: { hex: string; alpha: number } | undefined
  if (fill?.name === 'noFill') return null
  if (fill?.name === 'solidFill') color = resolveColor(fill, colors)
  else if (fill?.name === 'gradFill') color = resolveColor(dig(fill, 'gsLst', 'gs')?.children[0], colors)
  else if (style?.node) {
    const sf = style.node.children.find((c) => ['solidFill', 'noFill', 'gradFill'].includes(c.name))
    if (sf?.name === 'noFill') return null
    color = sf?.name === 'gradFill' ? resolveColor(dig(sf, 'gsLst', 'gs')?.children[0], style.colors) : resolveColor(sf ?? ref?.children[0], style.colors)
  }
  if (!color) return null
  const w = ln?.attrs.w !== undefined ? num(ln, 'w') : style?.node?.attrs.w !== undefined ? num(style.node, 'w') : ref ? (master.theme.lineWidths[num(ref, 'idx') - 1] ?? 12700) : 9525
  const end = (n: string) => END[child(ln, n)?.attrs.type ?? '']
  return { color: color.hex, width: pt(w), alpha: color.alpha < 1 ? color.alpha : undefined, dash: DASH[child(ln, 'prstDash')?.attrs.val ?? ''] ?? DASH[child(style?.node, 'prstDash')?.attrs.val ?? ''], head: end('headEnd'), tail: end('tailEnd') }
}

// ---------- custom geometry ----------

/** the arc of an ellipse (radii rx, ry) from angle a0 sweeping da (radians, clockwise on a y-down page) as cubic curves */
function arcCurves(x: number, y: number, rx: number, ry: number, a0: number, da: number): { segs: CustomPath['segs']; end: [number, number] } {
  const cx = x - rx * Math.cos(a0)
  const cy = y - ry * Math.sin(a0)
  const segs: CustomPath['segs'] = []
  const n = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 2)))
  const step = da / n
  const k = (4 / 3) * Math.tan(step / 4)
  let a = a0
  for (let i = 0; i < n; i++) {
    const b = a + step
    const [c0, s0, c1, s1] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)]
    segs.push(['C', cx + rx * (c0 - k * s0), cy + ry * (s0 + k * c0), cx + rx * (c1 + k * s1), cy + ry * (s1 - k * c1), cx + rx * c1, cy + ry * s1])
    a = b
  }
  return { segs, end: [cx + rx * Math.cos(a0 + da), cy + ry * Math.sin(a0 + da)] }
}

/** a shape's custom outline, with its guides worked out for the box it is drawn in */
function customPaths(geom: XmlNode, w: number, h: number): CustomPath[] {
  const names = boxGuides(w, h)
  for (const g of [...kids(child(geom, 'avLst'), 'gd'), ...kids(child(geom, 'gdLst'), 'gd')]) if (g.attrs.name) names.set(g.attrs.name, evalGuide(g.attrs.fmla ?? 'val 0', names))
  const val = (v: string | undefined) => (v === undefined ? 0 : names.has(v) ? names.get(v)! : Number(v) || 0)
  const out: CustomPath[] = []
  for (const p of kids(child(geom, 'pathLst'), 'path')) {
    const pw = p.attrs.w !== undefined ? num(p, 'w') : w
    const ph = p.attrs.h !== undefined ? num(p, 'h') : h
    const segs: CustomPath['segs'] = []
    let cur: [number, number] = [0, 0]
    let start: [number, number] = [0, 0]
    for (const c of p.children) {
      const pts = kids(c, 'pt').map((q): [number, number] => [val(q.attrs.x), val(q.attrs.y)])
      if (c.name === 'moveTo' && pts[0]) { segs.push(['M', ...pts[0]]); cur = start = pts[0] }
      else if (c.name === 'lnTo' && pts[0]) { segs.push(['L', ...pts[0]]); cur = pts[0] }
      else if (c.name === 'cubicBezTo' && pts.length === 3) { segs.push(['C', ...pts[0], ...pts[1], ...pts[2]]); cur = pts[2] }
      else if (c.name === 'quadBezTo' && pts.length === 2) {
        const [q, e] = pts
        segs.push(['C', cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1]), e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1]), ...e])
        cur = e
      } else if (c.name === 'arcTo') {
        const a = arcCurves(cur[0], cur[1], val(c.attrs.wR), val(c.attrs.hR), (val(c.attrs.stAng) / 60000) * (Math.PI / 180), (val(c.attrs.swAng) / 60000) * (Math.PI / 180))
        segs.push(...a.segs)
        cur = a.end
      } else if (c.name === 'close') { segs.push(['Z']); cur = start }
    }
    if (segs.length) out.push({ w: pw || 1, h: ph || 1, fill: p.attrs.fill !== 'none', stroke: p.attrs.stroke !== '0' && p.attrs.stroke !== 'false', segs })
  }
  return out
}

// ---------- text ----------

type TextCtx = {
  env: Env
  master: Master
  colors: ColorContext
  /** shape text levels, from the shape's own list style outwards to the master and presentation defaults */
  levels: (lvl: number) => Chain
  slideNumber: number
  /** the colour a style gives the text (a shape's font reference, a table style): above the master's defaults, below the shape's own settings */
  styleColor?: string
  /** the colour text has when nothing says */
  defaultColor?: string
  defaultBold?: boolean
  defaultSize?: number
  /** a font reference names the theme's major or minor font as the default face */
  defaultFont?: string
  fontScale: number
}

const attrOf = (nodes: Chain, name: string) => nodes.find((n) => n?.attrs[name] !== undefined)?.attrs[name]
const childOf = (nodes: Chain, name: string) => nodes.map((n) => child(n, name)).find(Boolean)

function fontName(face: string | undefined, theme: Theme): string | undefined {
  if (!face) return undefined
  if (face === '+mj-lt' || face === '+mj-ea' || face === '+mj-cs') return theme.major
  if (face === '+mn-lt' || face === '+mn-ea' || face === '+mn-cs') return theme.minor
  return face.startsWith('+') ? undefined : face
}

function spacing(node: XmlNode | undefined): { pts?: number; pct?: number } {
  const p = child(node, 'spcPts')
  const c = child(node, 'spcPct')
  return p ? { pts: num(p, 'val') / 100 } : c ? { pct: num(c, 'val') / 100000 } : {}
}

function paragraphs(tx: XmlNode | undefined, t: TextCtx): SlidePara[] {
  const out: SlidePara[] = []
  for (const p of kids(tx, 'p')) {
    const pPr = child(p, 'pPr')
    const lvl = Math.min(8, num(pPr, 'lvl'))
    const chain: Chain = [pPr, ...t.levels(lvl)]
    const runs: SlideRun[] = []
    const addRun = (text: string, rPr: XmlNode | undefined) => {
      const rchain: Chain = [rPr, ...chain.map((c) => child(c, 'defRPr'))]
      const sz = attrOf(rchain, 'sz')
      // the shape's own settings (the run, the paragraph, the shape's list style) come first, then a style, then the inherited defaults
      const fillIn = (nodes: Chain) => nodes.map((r) => child(r, 'solidFill') ?? child(r, 'gradFill')).find(Boolean)
      const colorOf = (n: XmlNode) => resolveColor(n.name === 'gradFill' ? dig(n, 'gsLst', 'gs')?.children[0] : n, t.colors)
      const own = fillIn(rchain.slice(0, 3))
      const inherited = fillIn(rchain.slice(3))
      const col = own ? colorOf(own) : t.styleColor ? { hex: t.styleColor, alpha: 1 } : inherited ? colorOf(inherited) : t.defaultColor ? { hex: t.defaultColor, alpha: 1 } : undefined
      const u = attrOf(rchain, 'u')
      const cap = attrOf(rchain, 'cap')
      const spc = attrOf(rchain, 'spc')
      const base = attrOf(rchain, 'baseline')
      const hl = childOf(rchain, 'highlight')
      runs.push({
        text,
        size: Math.round((sz ? Number(sz) / 100 : t.defaultSize ?? 18) * t.fontScale * 100) / 100,
        bold: attrOf(rchain, 'b') !== undefined ? on(attrOf(rchain, 'b')) : t.defaultBold,
        italic: on(attrOf(rchain, 'i')),
        underline: !!u && u !== 'none',
        color: col?.hex,
        alpha: col && col.alpha < 1 ? col.alpha : undefined,
        font: fontName(childOf(rchain, 'latin')?.attrs.typeface, t.master.theme) ?? t.defaultFont ?? t.master.theme.minor,
        caps: cap === 'all' ? 'all' : cap === 'small' ? 'small' : undefined,
        spacing: spc ? Number(spc) / 100 : undefined,
        baseline: base && Number(base) ? Number(base) / 100000 : undefined,
        highlight: hl ? resolveColor(hl, t.colors)?.hex : undefined,
      })
    }
    for (const c of p.children) {
      if (c.name === 'r') addRun(child(c, 't')?.text ?? '', child(c, 'rPr'))
      else if (c.name === 'br') addRun('\n', child(c, 'rPr'))
      else if (c.name === 'fld') addRun(c.attrs.type === 'slidenum' ? String(t.slideNumber) : (child(c, 't')?.text ?? ''), child(c, 'rPr'))
    }
    // a paragraph's runs are merged where nothing differs
    const merged: SlideRun[] = []
    const same = (a: SlideRun, b: SlideRun) => (['bold', 'italic', 'underline', 'size', 'color', 'font', 'caps', 'spacing', 'baseline', 'highlight', 'alpha'] as const).every((k) => a[k] === b[k])
    for (const r of runs) {
      const l = merged[merged.length - 1]
      if (l && same(l, r)) l.text += r.text
      else merged.push({ ...r })
    }
    const algn = attrOf(chain, 'algn')
    const ln = spacing(childOf(chain, 'lnSpc'))
    const bef = spacing(childOf(chain, 'spcBef'))
    const aft = spacing(childOf(chain, 'spcAft'))
    let bullet: string | undefined
    let bulletNode: XmlNode | undefined
    for (const n of chain) {
      if (!n) continue
      if (child(n, 'buNone')) break
      const ch = child(n, 'buChar')
      if (ch) { bullet = ch.attrs.char || '•'; bulletNode = n; break }
      if (child(n, 'buAutoNum')) { bullet = 'number'; bulletNode = n; break }
    }
    const first = merged[0]
    const size = first?.size ?? (Number(attrOf([child(p, 'endParaRPr'), ...chain.map((c) => child(c, 'defRPr'))], 'sz') ?? 1800) / 100) * t.fontScale
    const buClr = childOf(chain, 'buClr')
    const buSz = childOf(chain, 'buSzPct')
    out.push({
      runs: merged.filter((r) => r.text !== ''),
      align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' || algn === 'dist' ? 'justify' : 'left',
      bullet,
      // "+mj-lt" and the like name the theme's fonts
      bulletFont: bullet ? fontName((child(bulletNode, 'buFont') ?? childOf(chain, 'buFont'))?.attrs.typeface, t.master.theme) : undefined,
      bulletColor: bullet && buClr ? resolveColor(buClr, t.colors)?.hex : undefined,
      bulletScale: bullet && buSz ? num(buSz, 'val', 100000) / 100000 : undefined,
      marginLeft: pt(Number(attrOf(chain, 'marL') ?? 0)),
      indent: pt(Number(attrOf(chain, 'indent') ?? 0)),
      line: ln.pts,
      lineFactor: ln.pct !== undefined ? ln.pct : ln.pts === undefined ? 1 : undefined,
      before: bef.pts ?? (bef.pct !== undefined ? bef.pct * 1.2 * size : 0),
      after: aft.pts ?? (aft.pct !== undefined ? aft.pct * 1.2 * size : 0),
      size,
    })
  }
  return out
}

// ---------- shapes ----------

type Ctx = {
  env: Env
  /** the part the shapes come from (slide, layout or master): its relationships hold their pictures */
  part: Part
  layout?: Part
  master: Master
  colors: ColorContext
  slideNumber: number
  out: SlideShape[]
  /** master and layout shapes: drawn under, placeholders skipped, and text has no placeholder behind it */
  decoration: boolean
  /** a group's fill, for shapes inside it that say "the group's fill" */
  groupFill?: Paint | null
}

function bodyAttrs(slideBodyPr: XmlNode | undefined, layoutSp: XmlNode | undefined, masterSp: XmlNode | undefined) {
  const chain: Chain = [slideBodyPr, dig(layoutSp, 'txBody', 'bodyPr'), dig(masterSp, 'txBody', 'bodyPr')]
  const emu = (name: string, d: number) => pt(Number(attrOf(chain, name) ?? d))
  const anchor = attrOf(chain, 'anchor')
  const fit = chain.map((c) => child(c, 'normAutofit')).find(Boolean)
  const vert = attrOf(chain, 'vert')
  return {
    insets: [emu('lIns', 91440), emu('tIns', 45720), emu('rIns', 91440), emu('bIns', 45720)] as [number, number, number, number],
    anchor: (anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top') as 'top' | 'middle' | 'bottom',
    wrap: attrOf(chain, 'wrap') !== 'none',
    fontScale: fit?.attrs.fontScale ? num(fit, 'fontScale') / 100000 : 1,
    lineReduction: fit?.attrs.lnSpcReduction ? num(fit, 'lnSpcReduction') / 100000 : 0,
    vertical: vert === 'vert' || vert === 'eaVert' ? ('vert' as const) : vert === 'vert270' ? ('vert270' as const) : undefined,
  }
}

function textLevels(master: Master, env: Env, shapeLst: XmlNode | undefined, layoutSp: XmlNode | undefined, masterSp: XmlNode | undefined, ph: XmlNode | undefined): TextCtx['levels'] {
  const type = ph ? normType(ph.attrs.type) : undefined
  const style = !ph ? master.styles.other : type === 'title' ? master.styles.title : ['dt', 'ftr', 'sldNum'].includes(type!) ? master.styles.other : master.styles.body
  return (lvl) => {
    const n = `lvl${lvl + 1}pPr`
    return [child(shapeLst, n), child(dig(layoutSp, 'txBody', 'lstStyle'), n), child(dig(masterSp, 'txBody', 'lstStyle'), n), child(style, n), child(env.defaultText, n)]
  }
}

/** place a box through the group matrix: a plain scale-and-move goes into the box, anything else stays as the shape's xform */
function placed(xf: Xf, m: M): { x: number; y: number; w: number; h: number; xform?: M } {
  if (simple(m)) {
    const [x, y] = apply(m, xf.x, xf.y)
    return { x, y, w: xf.w * m[0], h: xf.h * m[3] }
  }
  return { x: xf.x, y: xf.y, w: xf.w, h: xf.h, xform: m }
}

function addShape(ctx: Ctx, node: XmlNode, m: M) {
  if (ctx.env.budget.shapes-- <= 0) throw new UserError('This presentation has too many shapes to read.')
  const { colors, master } = ctx
  const rels = ctx.part.rels

  if (node.name === 'grpSp') {
    const pr = child(node, 'grpSpPr')
    const x = child(pr, 'xfrm')
    const off = child(x, 'off')
    const ext = child(x, 'ext')
    const cOff = child(x, 'chOff')
    const cExt = child(x, 'chExt')
    let inner = m
    if (off && ext && cExt) {
      const kx = num(cExt, 'cx') ? num(ext, 'cx') / num(cExt, 'cx') : 1
      const ky = num(cExt, 'cy') ? num(ext, 'cy') / num(cExt, 'cy') : 1
      // child space -> the group's box on the parent, then the group's own turn and mirror about its middle
      const toBox: M = [kx, 0, 0, ky, pt(num(off, 'x') - num(cOff, 'x') * kx), pt(num(off, 'y') - num(cOff, 'y') * ky)]
      const xf = xfrmOf(pr)!
      inner = mul(mul(toBox, turnAbout(xf.rot, xf.flipH, xf.flipV, xf.x + xf.w / 2, xf.y + xf.h / 2)), m)
    }
    const fill = paintOf(pr?.children.find((c) => FILLS.includes(c.name)), colors, rels, ctx.env)
    const sub: Ctx = { ...ctx, groupFill: fill === undefined ? ctx.groupFill : fill }
    for (const c of node.children) if (SHAPES.includes(c.name)) addShape(sub, c, inner)
    return
  }

  if (node.name === 'graphicFrame') {
    const xf = xfrmOf(child(node, 'xfrm'))
    const data = dig(node, 'graphic', 'graphicData')
    const uri = data?.attrs.uri ?? ''
    if (!xf) return
    const b = placed(xf, m)
    const tbl = child(data, 'tbl')
    if (tbl) ctx.out.push(readTable(ctx, tbl, b))
    else if (/diagram/.test(uri) && smartArt(ctx, data!, xf, m)) return
    else {
      const chartRel = /chart/.test(uri) ? rels.get(child(data, 'chart')?.attrs.id ?? '') : undefined
      const chart = chartRel ? readChart(ctx.env.xml(chartRel.part), ctx.colors) : null
      if (chart) ctx.out.push({ kind: 'chart', ...b, chart })
      else ctx.out.push({ kind: 'unsupported', ...b, what: /chart/.test(uri) ? 'Chart' : /diagram/.test(uri) ? 'Diagram' : 'Object' })
    }
    return
  }

  const spPr = child(node, 'spPr')
  const ph = phOf(node)
  if (ph && ctx.decoration) return // a placeholder on a layout or master only says where and how; it draws nothing itself
  const layoutTree = dig(ctx.layout?.root, 'cSld', 'spTree')
  const masterTree = dig(master.part.root, 'cSld', 'spTree')
  const layoutSp = ph ? findPlaceholder(layoutTree, ph, true) : undefined
  // the master's placeholder is the one of the layout placeholder's type (a slide's own may leave its type out)
  const masterSp = ph ? findPlaceholder(masterTree, (layoutSp && phOf(layoutSp)) || ph, false) : undefined
  const xf = xfrmOf(spPr) ?? xfrmOf(child(layoutSp, 'spPr')) ?? xfrmOf(child(masterSp, 'spPr'))
  if (!xf) return
  // the shape's own turn and mirror, then the groups around it
  const own = turnAbout(xf.rot, xf.flipH, xf.flipV, xf.x + xf.w / 2, xf.y + xf.h / 2)
  const whole = mul(own, m)
  const b = simple(m) ? placed(xf, m) : { x: xf.x, y: xf.y, w: xf.w, h: xf.h }
  const geomNode = child(spPr, 'prstGeom') ?? child(spPr, 'custGeom')
  const prst = child(spPr, 'prstGeom')?.attrs.prst
  const adjust = prst ? Object.fromEntries(kids(child(child(spPr, 'prstGeom'), 'avLst'), 'gd').map((g) => [g.attrs.name, Number((g.attrs.fmla ?? '').replace(/^val\s+/, '')) || 0])) : undefined
  // a matrix that turns or mirrors stays with the shape; a plain one was put into the box
  const xform = simple(m) ? undefined : whole
  const turned = simple(m) ? { rotation: xf.rot || undefined, flipH: xf.flipH || undefined, flipV: xf.flipV || undefined } : {}

  if (node.name === 'pic') {
    const fill = paintOf(child(node, 'blipFill'), colors, rels, ctx.env) ?? paintOf(dig(layoutSp ?? node, 'blipFill'), colors, rels, ctx.env)
    if (!fill || fill.type !== 'picture') return
    ctx.out.push({ kind: 'pic', ...b, bytes: fill.bytes, type: fill.kind, name: fill.name, alt: dig(node, 'nvPicPr', 'cNvPr')?.attrs.descr, crop: fill.crop, alpha: fill.alpha, geometry: prst && prst !== 'rect' ? prst : undefined, adjust, xform, ...turned })
    return
  }

  const style = child(node, 'style')
  const ownFill = spPr?.children.find((c) => FILLS.includes(c.name))
  let paint: Paint | null | undefined
  if (ownFill?.name === 'grpFill') paint = ctx.groupFill ?? null
  else if (ownFill) paint = paintOf(ownFill, colors, rels, ctx.env)
  else {
    const ref = child(style, 'fillRef')
    const idx = num(ref, 'idx')
    if (ref && idx > 0) {
      const s = themeStyle(ref, idx >= 1000 ? master.theme.bgFillStyles : master.theme.fillStyles, colors)
      // a style's picture fill lives in the theme's relationships
      paint = s.node ? paintOf(s.node, s.colors, master.themePart?.rels ?? rels, ctx.env) : resolveColor(ref.children[0], colors) ? { type: 'solid', color: resolveColor(ref.children[0], colors)!.hex } : undefined
    }
  }
  const ln = child(spPr, 'ln')
  const stroke = strokeOf(ln, child(style, 'lnRef'), master, colors)

  // a bent or curved connector is an open outline, drawn like a shape with no fill
  if (node.name === 'cxnSp' && prst && /^(bent|curved)Connector/.test(prst)) {
    if (stroke) ctx.out.push({ kind: 'text', ...b, paragraphs: [], line: stroke, geometry: prst, adjust, xform, ...turned })
    return
  }
  if (node.name === 'cxnSp' || prst === 'line' || prst === 'straightConnector1') {
    const l = stroke ?? (node.name === 'cxnSp' ? { color: '000000', width: 0.75 } : null)
    if (!l) return
    // a connector's flips say which corner it starts from; its box's corners go through the group matrix
    const [x0, x1] = xf.flipH ? [xf.x + xf.w, xf.x] : [xf.x, xf.x + xf.w]
    const [y0, y1] = xf.flipV ? [xf.y + xf.h, xf.y] : [xf.y, xf.y + xf.h]
    const turn = xf.rot ? turnAbout(xf.rot, false, false, xf.x + xf.w / 2, xf.y + xf.h / 2) : IDENT
    const [p0, p1] = [apply(mul(turn, m), x0, y0), apply(mul(turn, m), x1, y1)]
    ctx.out.push({ kind: 'line', x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1], color: l.color, width: l.width, dash: l.dash, alpha: l.alpha, head: l.head, tail: l.tail })
    return
  }

  const tx = child(node, 'txBody')
  const body = bodyAttrs(child(tx, 'bodyPr'), layoutSp, masterSp)
  const fontRef = child(style, 'fontRef')
  const text: TextCtx = {
    env: ctx.env,
    master,
    colors,
    levels: textLevels(master, ctx.env, child(tx, 'lstStyle'), layoutSp, masterSp, ph),
    slideNumber: ctx.slideNumber,
    styleColor: resolveColor(fontRef?.children[0], colors)?.hex,
    defaultColor: resolveColor({ name: 'schemeClr', attrs: { val: 'tx1' }, children: [], text: '' }, colors)?.hex,
    defaultFont: fontRef?.attrs.idx === 'major' ? master.theme.major : fontRef?.attrs.idx === 'minor' ? master.theme.minor : undefined,
    fontScale: body.fontScale,
  }
  const paras = tx ? paragraphs(tx, text) : []
  const hasText = paras.some((p) => p.runs.some((r) => r.text.trim()))
  if (!hasText && !paint && !stroke) return
  const box: SlideBox = {
    kind: 'text', ...b, paragraphs: hasText ? paras : [], anchor: body.anchor, wrap: body.wrap, insets: body.insets,
    paint: paint ?? undefined,
    line: stroke ?? undefined,
    geometry: prst ?? (geomNode?.name === 'custGeom' ? 'custom' : 'rect'),
    adjust,
    paths: geomNode?.name === 'custGeom' ? customPaths(geomNode, xf.w * EMU, xf.h * EMU) : undefined,
    vertical: body.vertical,
    xform,
    ...turned,
    fontScale: body.fontScale !== 1 ? body.fontScale : undefined, lineReduction: body.lineReduction || undefined,
  }
  // the text of SmartArt and some shapes sits in its own box (txXfrm), not the shape's
  const txXf = xfrmOf(child(node, 'txXfrm'))
  if (txXf && hasText) {
    ctx.out.push({ ...box, paragraphs: [], line: box.line })
    const t = simple(m) ? placed(txXf, m) : { x: txXf.x, y: txXf.y, w: txXf.w, h: txXf.h }
    ctx.out.push({ ...box, ...t, paint: undefined, line: undefined, paths: undefined, geometry: 'rect', paragraphs: paras, rotation: txXf.rot || undefined })
    return
  }
  ctx.out.push(box)
}

/** SmartArt: the shapes PowerPoint drew for it and stored next to its data. false when there is no such drawing. */
function smartArt(ctx: Ctx, data: XmlNode, xf: Xf, m: M): boolean {
  const ids = child(data, 'relIds')
  const dm = ctx.part.rels.get(ids?.attrs.dm ?? '')
  const model = dm ? ctx.env.xml(dm.part) : undefined
  let drawingRel: string | undefined
  const find = (n: XmlNode) => {
    if (n.name === 'dataModelExt' && n.attrs.relId) drawingRel = n.attrs.relId
    else n.children.forEach(find)
  }
  if (model) find(model)
  const rel = drawingRel ? ctx.part.rels.get(drawingRel) : undefined
  const drawing = rel ? ctx.env.xml(rel.part) : undefined
  const tree = child(drawing, 'spTree')
  if (!rel || !tree) return false
  // the drawing's shapes are placed relative to the frame
  const inFrame = mul([1, 0, 0, 1, xf.x, xf.y], m)
  const sub: Ctx = { ...ctx, part: { name: rel.part, root: drawing!, rels: readRels(ctx.env.xml(relsOf(rel.part)), rel.part) } }
  for (const c of tree.children) if (SHAPES.includes(c.name)) addShape(sub, c, inFrame)
  return true
}

// ---------- tables ----------

type Edge = { color: string; width: number }
type Cell = { fill?: string; bold?: boolean; color?: string; edges: Partial<Record<'l' | 'r' | 't' | 'b', Edge>>; /** lines between cells, horizontal (between rows) and vertical (between columns) */ inside: { h?: Edge; v?: Edge } }

function styleCell(style: XmlNode | undefined, colors: ColorContext): Cell {
  const c: Cell = { edges: {}, inside: {} }
  const tx = child(style, 'tcTxStyle')
  if (tx) {
    c.bold = tx.attrs.b ? on(tx.attrs.b) : undefined
    c.color = resolveColor(tx.children.find((x) => x.name !== 'fontRef' && x.name !== 'font') ?? child(tx, 'fontRef')?.children[0], colors)?.hex
  }
  const fill = dig(style, 'tcStyle', 'fill', 'solidFill')
  if (fill) c.fill = resolveColor(fill, colors)?.hex
  const bdr = dig(style, 'tcStyle', 'tcBdr')
  const side = (n: XmlNode | undefined) => {
    const ln = child(n, 'ln')
    const f = child(ln, 'solidFill')
    return f ? { color: resolveColor(f, colors)?.hex ?? '000000', width: pt(num(ln, 'w', 12700)) } : undefined
  }
  if (bdr) {
    c.edges = { l: side(child(bdr, 'left')), r: side(child(bdr, 'right')), t: side(child(bdr, 'top')), b: side(child(bdr, 'bottom')) }
    c.inside = { h: side(child(bdr, 'insideH')), v: side(child(bdr, 'insideV')) }
  }
  return c
}

function readTable(ctx: Ctx, tbl: XmlNode, b: { x: number; y: number; w: number; h: number; xform?: M }): SlideTable {
  const { colors } = ctx
  const pr = child(tbl, 'tblPr')
  const styleId = child(pr, 'tableStyleId')?.text.trim() ?? ''
  const style = ctx.env.tableStyles.get(styleId) ?? BUILTIN_TABLE_STYLES[styleId]
  const parts = (n: string) => styleCell(child(style, n), colors)
  const whole = parts('wholeTbl')
  const first = on(pr?.attrs.firstRow) ? parts('firstRow') : undefined
  const last = on(pr?.attrs.lastRow) ? parts('lastRow') : undefined
  const firstCol = on(pr?.attrs.firstCol) ? parts('firstCol') : undefined
  const band1 = on(pr?.attrs.bandRow) ? parts('band1H') : undefined
  const band2 = on(pr?.attrs.bandRow) ? parts('band2H') : undefined
  const colWidths = kids(child(tbl, 'tblGrid'), 'gridCol').map((g) => pt(num(g, 'w')))
  const trs = kids(tbl, 'tr')
  const rowHeights = trs.map((r) => pt(num(r, 'h')))
  const cells: SlideTableCell[][] = []
  trs.forEach((tr, r) => {
    const row: SlideTableCell[] = []
    let c = 0
    for (const tc of kids(tr, 'tc')) {
      const pc = child(tc, 'tcPr')
      // later layers win: whole table, banding, first/last row and column
      const layers = [whole, r > 0 || !first ? ((on(pr?.attrs.firstRow) ? r - 1 : r) % 2 === 0 ? band1 : band2) : undefined, r === 0 ? first : undefined, r === trs.length - 1 ? last : undefined, c === 0 ? firstCol : undefined].filter((x): x is Cell => !!x)
      const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as T
      const merged = layers.reduce<Cell>((a, l) => ({ fill: l.fill ?? a.fill, bold: l.bold ?? a.bold, color: l.color ?? a.color, edges: { ...a.edges, ...defined(l.edges) }, inside: { ...a.inside, ...defined(l.inside) } }), { edges: {}, inside: {} })
      const fillNode = pc?.children.find((x) => ['solidFill', 'noFill', 'gradFill'].includes(x.name))
      const fill = fillNode ? (fillNode.name === 'noFill' ? undefined : resolveColor(fillNode.name === 'gradFill' ? dig(fillNode, 'gsLst', 'gs')?.children[0] : fillNode, colors)?.hex) : merged.fill
      // the style's outer lines are on the table's outside; between cells its inside lines apply
      const spanC = num(tc, 'gridSpan', 1)
      const spanR = num(tc, 'rowSpan', 1)
      const edges: SlideTableCell['edges'] = {
        l: c === 0 ? merged.edges.l : merged.inside.v,
        r: c + spanC >= colWidths.length ? merged.edges.r : merged.inside.v,
        t: r === 0 ? merged.edges.t : merged.inside.h,
        b: r + spanR >= trs.length ? merged.edges.b : merged.inside.h,
      }
      for (const k of ['l', 'r', 't', 'b'] as const) if (!edges[k]) delete edges[k]
      for (const [k, n] of [['l', 'lnL'], ['r', 'lnR'], ['t', 'lnT'], ['b', 'lnB']] as const) {
        const ln = child(pc, n)
        if (!ln) continue
        const f = child(ln, 'solidFill')
        if (f) edges[k] = { color: resolveColor(f, colors)?.hex ?? '000000', width: pt(num(ln, 'w', 12700)) }
        else if (child(ln, 'noFill')) delete edges[k]
      }
      const text: TextCtx = {
        env: ctx.env, master: ctx.master, colors, slideNumber: ctx.slideNumber, fontScale: 1, styleColor: merged.color, defaultColor: resolveColor({ name: 'schemeClr', attrs: { val: 'tx1' }, children: [], text: '' }, colors)?.hex, defaultBold: merged.bold, defaultSize: 18,
        levels: (lvl) => [undefined, child(ctx.env.defaultText, `lvl${lvl + 1}pPr`)], // the first slot is the shape's own list style, which a cell has none of
      }
      const anchor = pc?.attrs.anchor
      row.push({
        paragraphs: paragraphs(child(tc, 'txBody'), text),
        cols: spanC > 1 ? spanC : undefined,
        rows: spanR > 1 ? spanR : undefined,
        covered: on(tc.attrs.hMerge) && on(tc.attrs.vMerge) ? 'hv' : on(tc.attrs.hMerge) ? 'h' : on(tc.attrs.vMerge) ? 'v' : undefined,
        fill, edges,
        insets: [pt(num(pc, 'marL', 91440)), pt(num(pc, 'marT', 45720)), pt(num(pc, 'marR', 91440)), pt(num(pc, 'marB', 45720))],
        anchor: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
      })
      c++
    }
    cells.push(row)
  })
  return { kind: 'table', ...b, colWidths, rowHeights, cells }
}

// ---------- the deck ----------

/** a slide's background (from the part that holds it): its own fill, or the theme's background style it points at */
function background(part: Part | undefined, master: Master, colors: ColorContext, env: Env): Paint | undefined {
  const bg = dig(part?.root, 'cSld', 'bg')
  if (!bg || !part) return undefined
  const pr = child(bg, 'bgPr')
  const ref = child(bg, 'bgRef')
  const fill = pr?.children.find((c) => FILLS.includes(c.name))
  if (fill) return paintOf(fill, colors, part.rels, env) ?? undefined
  if (ref) {
    // 1001 and up point into the theme's background fills, 1 to 999 into its shape fills
    const idx = num(ref, 'idx')
    const s = themeStyle(ref, master.theme.fillStyles, colors)
    const node = idx >= 1001 ? master.theme.bgFillStyles[idx - 1001] : s.node
    const p = node ? paintOf(node, s.colors, master.themePart?.rels ?? part.rels, env) : undefined
    if (p) return p
    const c = resolveColor(ref.children[0], colors)
    return c ? { type: 'solid', color: c.hex } : undefined
  }
  return undefined
}

/** every slide of a presentation, in order; hidden slides are marked */
export async function readPptx(bytes: Uint8Array): Promise<Deck> {
  const parts = await unzip(bytes)
  if (parts.has('EncryptedPackage')) throw new UserError('This presentation is password protected. Remove the password in PowerPoint, then try again.')
  const cache = new Map<string, XmlNode | undefined>()
  const xml = (name: string) => {
    if (cache.has(name)) return cache.get(name)
    const b = parts.get(name)
    const x = b ? parseXml(new TextDecoder().decode(b)) : undefined
    cache.set(name, x)
    return x
  }
  const relsFile = (name: string) => readRels(xml(relsOf(name)), name)
  const partOf = (name: string | undefined): Part | undefined => {
    const root = name ? xml(name) : undefined
    return name && root ? { name, root, rels: relsFile(name) } : undefined
  }
  const root = readRels(xml('_rels/.rels'), '')
  const presPath = [...root.values()].find((r) => r.type.endsWith('/officeDocument'))?.part
  const pres = presPath ? xml(presPath) : undefined
  if (!presPath || !pres || pres.name !== 'presentation') throw new UserError("This isn't a PowerPoint presentation (.pptx). Older .ppt files must be saved as .pptx first.")
  const presRels = relsFile(presPath)
  const size = child(pres, 'sldSz')
  const width = pt(num(size, 'cx', 9144000))
  const height = pt(num(size, 'cy', 5143500))
  const tsPath = [...presRels.values()].find((r) => r.type.endsWith('/tableStyles'))?.part
  const tableStyles = new Map<string, XmlNode>()
  for (const s of kids(tsPath ? xml(tsPath) : undefined, 'tblStyle')) if (s.attrs.styleId) tableStyles.set(s.attrs.styleId, s)
  const env: Env = { xml, bytes: (n) => parts.get(n), defaultText: child(pres, 'defaultTextStyle'), tableStyles, budget: { shapes: MAX_SHAPES } }

  // each layout belongs to a master, each master has its theme: a deck can have several
  const masters = new Map<string, Master>()
  const masterOf = (path: string | undefined): Master | undefined => {
    if (!path) return undefined
    const known = masters.get(path)
    if (known) return known
    const part = partOf(path)
    if (!part) return undefined
    const themePart = partOf([...part.rels.values()].find((r) => r.type.endsWith('/theme'))?.part)
    const clr = child(part.root, 'clrMap')
    const m: Master = {
      part, themePart,
      theme: themePart ? readTheme(themePart.root) : DEFAULT_THEME,
      clrMap: clr ? clr.attrs : { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' },
      styles: { title: dig(part.root, 'txStyles', 'titleStyle'), body: dig(part.root, 'txStyles', 'bodyStyle'), other: dig(part.root, 'txStyles', 'otherStyle') },
    }
    masters.set(path, m)
    return m
  }
  const firstMaster = [...presRels.values()].find((r) => r.type.endsWith('/slideMaster'))?.part

  const slides: Slide[] = []
  const ids = kids(child(pres, 'sldIdLst'), 'sldId')
  for (const [i, id] of ids.entries()) {
    const rel = presRels.get(id.attrs.id ?? '')
    const slide = partOf(rel?.part)
    if (!slide || slide.root.name !== 'sld') continue
    const layout = partOf([...slide.rels.values()].find((r) => r.type.endsWith('/slideLayout'))?.part)
    const master = masterOf(layout ? [...layout.rels.values()].find((r) => r.type.endsWith('/slideMaster'))?.part : firstMaster) ?? masterOf(firstMaster)
    if (!master) continue
    // a slide or layout can map the theme's colours its own way
    const override = dig(slide.root, 'clrMapOvr', 'overrideClrMapping') ?? dig(layout?.root, 'clrMapOvr', 'overrideClrMapping')
    const colors: ColorContext = { theme: master.theme, clrMap: override ? override.attrs : master.clrMap }
    const shapes: SlideShape[] = []
    const draw = (part: Part | undefined, decoration: boolean) => {
      const tree = dig(part?.root, 'cSld', 'spTree')
      if (!part || !tree) return
      const ctx: Ctx = { env, part, layout, master, colors, slideNumber: i + 1, out: shapes, decoration }
      for (const c of tree.children) if (SHAPES.includes(c.name)) addShape(ctx, c, IDENT)
    }
    if (slide.root.attrs.showMasterSp !== '0' && layout?.root.attrs.showMasterSp !== '0') draw(master.part, true)
    if (slide.root.attrs.showMasterSp !== '0') draw(layout, true)
    draw(slide, false)
    const bg = background(slide, master, colors, env) ?? background(layout, master, colors, env) ?? background(master.part, master, colors, env)
    slides.push({ backgroundPaint: bg, background: bg?.type === 'solid' ? bg.color : undefined, shapes, hidden: slide.root.attrs.show === '0' })
  }
  if (!slides.length) throw new UserError('This presentation has no slides that can be read.')
  return { width, height, slides }
}
