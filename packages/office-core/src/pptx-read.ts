// Read a presentation (.pptx) into a Deck with everything resolved: positions in points, the colours, fonts and sizes each
// paragraph ends up with after the slide, its layout, the master and the theme have all had their say, and master and layout
// shapes folded in under each slide's own. What is not read: charts, diagrams, embedded objects (shown as a marked gap),
// animations, notes, vertical text, custom shapes (drawn as their bounding box) and gradients (their first colour).
import { UserError, unzip } from '@ream/core'
import { resolveColor, type ColorContext } from './drawingml.ts'
import { DEFAULT_THEME, readRels, readTheme, relsOf, type Theme } from './ooxml.ts'
import type { Deck, Slide, SlideBox, SlidePara, SlideRun, SlideShape, SlideTable, SlideTableCell } from './pptx-model.ts'
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

type Rel = { part: string; type: string; external: boolean }
type Chain = (XmlNode | undefined)[]

type Env = {
  xml: (name: string) => XmlNode | undefined
  bytes: (name: string) => Uint8Array | undefined
  theme: Theme
  clrMap: Record<string, string>
  masterStyles: { title?: XmlNode; body?: XmlNode; other?: XmlNode }
  defaultText?: XmlNode
  tableStyles: Map<string, XmlNode>
  budget: { shapes: number }
}

/** where a part's pieces come from: its XML and its relationships */
type Part = { name: string; root: XmlNode; rels: Map<string, Rel> }

type Xf = { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }
type Tf = { sx: number; sy: number; tx: number; ty: number }
const IDENT: Tf = { sx: 1, sy: 1, tx: 0, ty: 0 }

const xfrmOf = (spPr: XmlNode | undefined): Xf | undefined => {
  const x = child(spPr, 'xfrm') ?? child(spPr, 'grpSpPr')
  const off = child(x, 'off')
  const ext = child(x, 'ext')
  if (!off || !ext) return undefined
  return { x: pt(num(off, 'x')), y: pt(num(off, 'y')), w: pt(num(ext, 'cx')), h: pt(num(ext, 'cy')), rot: num(x, 'rot') / 60000, flipH: on(x!.attrs.flipH), flipV: on(x!.attrs.flipV) }
}
const place = (xf: Xf, t: Tf) => ({ x: t.tx + t.sx * xf.x, y: t.ty + t.sy * xf.y, w: xf.w * t.sx, h: xf.h * t.sy })

// ---------- placeholders ----------

const phOf = (sp: XmlNode) => dig(sp, 'nvSpPr', 'nvPr', 'ph') ?? dig(sp, 'nvPicPr', 'nvPr', 'ph') ?? dig(sp, 'nvGraphicFramePr', 'nvPr', 'ph')
const normType = (t?: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t ?? 'body')

/** the placeholder in a layout or master that a placeholder on a slide takes its place and type from */
function findPlaceholder(tree: XmlNode | undefined, ph: XmlNode): XmlNode | undefined {
  const all = (tree?.children ?? []).filter((c) => c.name === 'sp' && phOf(c))
  const idx = ph.attrs.idx
  return (idx !== undefined ? all.find((s) => phOf(s)!.attrs.idx === idx) : undefined) ?? all.find((s) => normType(phOf(s)!.attrs.type) === normType(ph.attrs.type))
}

// ---------- text ----------

type TextCtx = {
  env: Env
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
  fontScale: number
}

const attrOf = (nodes: Chain, name: string) => nodes.find((n) => n?.attrs[name] !== undefined)?.attrs[name]
const childOf = (nodes: Chain, name: string) => nodes.map((n) => child(n, name)).find(Boolean)

function fontName(face: string | undefined, theme: Theme): string | undefined {
  if (!face) return undefined
  if (face === '+mj-lt' || face === '+mj-ea') return theme.major
  if (face === '+mn-lt' || face === '+mn-ea') return theme.minor
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
      const fillIn = (nodes: Chain) => nodes.map((r) => child(r, 'solidFill')).find(Boolean)
      const own = fillIn(rchain.slice(0, 3))
      const inherited = fillIn(rchain.slice(3))
      const col = own ? resolveColor(own, t.colors)?.hex : t.styleColor ?? (inherited ? resolveColor(inherited, t.colors)?.hex : t.defaultColor)
      const u = attrOf(rchain, 'u')
      runs.push({
        text,
        size: Math.round(((sz ? Number(sz) / 100 : t.defaultSize ?? 18) * t.fontScale) * 100) / 100,
        bold: attrOf(rchain, 'b') !== undefined ? on(attrOf(rchain, 'b')) : t.defaultBold,
        italic: on(attrOf(rchain, 'i')),
        underline: !!u && u !== 'none',
        color: col,
        font: fontName(childOf(rchain, 'latin')?.attrs.typeface, t.env.theme) ?? t.env.theme.minor,
      })
    }
    for (const c of p.children) {
      if (c.name === 'r') addRun(child(c, 't')?.text ?? '', child(c, 'rPr'))
      else if (c.name === 'br') addRun('\n', child(c, 'rPr'))
      else if (c.name === 'fld') addRun(c.attrs.type === 'slidenum' ? String(t.slideNumber) : (child(c, 't')?.text ?? ''), child(c, 'rPr'))
    }
    // a paragraph's runs are merged where nothing differs
    const merged: SlideRun[] = []
    for (const r of runs) {
      const l = merged[merged.length - 1]
      if (l && l.bold === r.bold && l.italic === r.italic && l.underline === r.underline && l.size === r.size && l.color === r.color && l.font === r.font) l.text += r.text
      else merged.push({ ...r })
    }
    const algn = attrOf(chain, 'algn')
    const ln = spacing(childOf(chain, 'lnSpc'))
    const bef = spacing(childOf(chain, 'spcBef'))
    const aft = spacing(childOf(chain, 'spcAft'))
    let bullet: string | undefined
    for (const n of chain) {
      if (!n) continue
      if (child(n, 'buNone')) break
      const ch = child(n, 'buChar')
      if (ch) { bullet = ch.attrs.char || '•'; break }
      if (child(n, 'buAutoNum')) { bullet = 'number'; break }
    }
    const first = merged[0]
    const size = first?.size ?? Number(attrOf([child(p, 'endParaRPr'), ...chain.map((c) => child(c, 'defRPr'))], 'sz') ?? 1800) / 100 * t.fontScale
    const sizeForSpacing = size
    out.push({
      runs: merged.filter((r) => r.text !== ''),
      align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' || algn === 'dist' ? 'justify' : 'left',
      bullet,
      marginLeft: pt(Number(attrOf(chain, 'marL') ?? 0)),
      indent: pt(Number(attrOf(chain, 'indent') ?? 0)),
      line: ln.pts,
      lineFactor: ln.pct !== undefined ? ln.pct : ln.pts === undefined ? 1 : undefined,
      before: bef.pts ?? (bef.pct !== undefined ? bef.pct * 1.2 * sizeForSpacing : 0),
      after: aft.pts ?? (aft.pct !== undefined ? aft.pct * 1.2 * sizeForSpacing : 0),
      size,
    })
  }
  return out
}

// ---------- shapes ----------

type Look = { fill?: { hex: string; alpha: number }; line?: { hex: string; width: number; dash?: 'dash' | 'dot' | 'dashDot' } }

const DASH: Record<string, 'dash' | 'dot' | 'dashDot'> = { dash: 'dash', sysDash: 'dash', lgDash: 'dash', dot: 'dot', sysDot: 'dot', dashDot: 'dashDot', lgDashDot: 'dashDot', sysDashDot: 'dashDot' }

/** fill and line of a shape: its own properties, else what its style reference points at */
function lookOf(spPr: XmlNode | undefined, style: XmlNode | undefined, colors: ColorContext, theme: Theme): Look {
  const look: Look = {}
  const styleColor = (ref: XmlNode | undefined) => (ref && num(ref, 'idx') > 0 ? resolveColor(ref.children[0], colors) : undefined)
  const fillNode = spPr?.children.find((c) => ['solidFill', 'noFill', 'gradFill', 'pattFill', 'blipFill', 'grpFill'].includes(c.name))
  if (fillNode?.name === 'solidFill') look.fill = resolveColor(fillNode, colors)
  // ponytail: a gradient is drawn as its first colour; add real gradients when slides need them
  else if (fillNode?.name === 'gradFill') look.fill = resolveColor(dig(fillNode, 'gsLst', 'gs')?.children[0], colors)
  else if (!fillNode) look.fill = styleColor(child(style, 'fillRef'))
  const ln = child(spPr, 'ln')
  const lnFill = ln?.children.find((c) => ['solidFill', 'noFill', 'gradFill', 'pattFill'].includes(c.name))
  const ref = child(style, 'lnRef')
  const refWidth = ref && num(ref, 'idx') > 0 ? (theme.lineWidths[num(ref, 'idx') - 1] ?? 12700) : 0
  if (lnFill?.name === 'solidFill') look.line = { hex: resolveColor(lnFill, colors)?.hex ?? '000000', width: pt(ln!.attrs.w ? num(ln, 'w') : refWidth || 12700) }
  else if (!lnFill && ref) {
    const c = styleColor(ref)
    if (c) look.line = { hex: c.hex, width: pt(ln?.attrs.w ? num(ln, 'w') : refWidth) }
  }
  if (look.line) look.line.dash = DASH[child(ln, 'prstDash')?.attrs.val ?? '']
  return look
}

type Ctx = {
  env: Env
  slide: Part
  layout?: Part
  master?: Part
  slideNumber: number
  out: SlideShape[]
  /** master and layout shapes: drawn under, placeholders skipped, and text has no placeholder behind it */
  decoration: boolean
}

function bodyAttrs(slideBodyPr: XmlNode | undefined, layoutSp: XmlNode | undefined, masterSp: XmlNode | undefined) {
  const chain: Chain = [slideBodyPr, dig(layoutSp, 'txBody', 'bodyPr'), dig(masterSp, 'txBody', 'bodyPr')]
  const emu = (name: string, d: number) => pt(Number(attrOf(chain, name) ?? d))
  const anchor = attrOf(chain, 'anchor')
  const fit = chain.map((c) => child(c, 'normAutofit')).find(Boolean)
  return {
    insets: [emu('lIns', 91440), emu('tIns', 45720), emu('rIns', 91440), emu('bIns', 45720)] as [number, number, number, number],
    anchor: (anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top') as 'top' | 'middle' | 'bottom',
    wrap: attrOf(chain, 'wrap') !== 'none',
    fontScale: fit?.attrs.fontScale ? num(fit, 'fontScale') / 100000 : 1,
    lineReduction: fit?.attrs.lnSpcReduction ? num(fit, 'lnSpcReduction') / 100000 : 0,
  }
}

function textLevels(env: Env, shapeLst: XmlNode | undefined, layoutSp: XmlNode | undefined, masterSp: XmlNode | undefined, ph: XmlNode | undefined): TextCtx['levels'] {
  const type = ph ? normType(ph.attrs.type) : undefined
  const style = !ph ? env.masterStyles.other : type === 'title' ? env.masterStyles.title : ['dt', 'ftr', 'sldNum'].includes(type!) ? env.masterStyles.other : env.masterStyles.body
  return (lvl) => {
    const n = `lvl${lvl + 1}pPr`
    return [child(shapeLst, n), child(dig(layoutSp, 'txBody', 'lstStyle'), n), child(dig(masterSp, 'txBody', 'lstStyle'), n), child(style, n), child(env.defaultText, n)]
  }
}

function addShape(ctx: Ctx, node: XmlNode, t: Tf) {
  if (ctx.env.budget.shapes-- <= 0) throw new UserError('This presentation has too many shapes to read.')
  const colors: ColorContext = { theme: ctx.env.theme, clrMap: ctx.env.clrMap }
  const rels = ctx.slide.rels

  if (node.name === 'grpSp') {
    const x = child(node, 'grpSpPr')
    const off = child(child(x, 'xfrm'), 'off')
    const ext = child(child(x, 'xfrm'), 'ext')
    const cOff = child(child(x, 'xfrm'), 'chOff')
    const cExt = child(child(x, 'xfrm'), 'chExt')
    let inner = t
    if (off && ext && cExt && num(cExt, 'cx') && num(cExt, 'cy')) {
      const kx = num(ext, 'cx') / num(cExt, 'cx')
      const ky = num(ext, 'cy') / num(cExt, 'cy')
      inner = { sx: t.sx * kx, sy: t.sy * ky, tx: t.tx + t.sx * pt(num(off, 'x') - num(cOff, 'x') * kx), ty: t.ty + t.sy * pt(num(off, 'y') - num(cOff, 'y') * ky) }
    }
    for (const c of node.children) if (['sp', 'pic', 'cxnSp', 'grpSp', 'graphicFrame'].includes(c.name)) addShape(ctx, c, inner)
    return
  }

  if (node.name === 'graphicFrame') {
    const xf = xfrmOf(node)
    const uri = dig(node, 'graphic', 'graphicData')?.attrs.uri ?? ''
    if (!xf) return
    const b = place(xf, t)
    const tbl = dig(node, 'graphic', 'graphicData', 'tbl')
    if (tbl) ctx.out.push(readTable(ctx, tbl, b))
    else ctx.out.push({ kind: 'unsupported', ...b, what: /chart/.test(uri) ? 'Chart' : /diagram/.test(uri) ? 'Diagram' : 'Object' })
    return
  }

  if (node.name === 'pic') {
    const spPr = child(node, 'spPr')
    const ph = phOf(node)
    const xf = xfrmOf(spPr) ?? (ph ? xfrmOf(child(findPlaceholder(dig(ctx.layout?.root, 'cSld', 'spTree'), ph), 'spPr')) : undefined)
    const rid = dig(node, 'blipFill', 'blip')?.attrs.embed
    const rel = rid ? rels.get(rid) : undefined
    const data = rel ? ctx.env.bytes(rel.part) : undefined
    if (!xf || !data || !rel) return
    const ext = rel.part.split('.').pop()?.toLowerCase()
    const src = child(child(node, 'blipFill'), 'srcRect')
    const b = place(xf, t)
    ctx.out.push({
      kind: 'pic', ...b, bytes: data,
      type: ext === 'png' ? 'png' : ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : 'other',
      name: rel.part,
      alt: dig(node, 'nvPicPr', 'cNvPr')?.attrs.descr,
      crop: src ? [num(src, 'l') / 100000, num(src, 't') / 100000, num(src, 'r') / 100000, num(src, 'b') / 100000] : undefined,
      rotation: xf.rot || undefined,
    })
    return
  }

  // sp and cxnSp
  const spPr = child(node, 'spPr')
  const ph = phOf(node)
  if (ph && ctx.decoration) return // a placeholder on a layout or master only says where and how; it draws nothing itself
  const layoutTree = ctx.layout ? dig(ctx.layout.root, 'cSld', 'spTree') : undefined
  const masterTree = ctx.master ? dig(ctx.master.root, 'cSld', 'spTree') : undefined
  const layoutSp = ph && !ctx.decoration ? findPlaceholder(layoutTree, ph) : undefined
  const masterSp = ph && !ctx.decoration ? findPlaceholder(masterTree, ph) : undefined
  const xf = xfrmOf(spPr) ?? xfrmOf(child(layoutSp, 'spPr')) ?? xfrmOf(child(masterSp, 'spPr'))
  if (!xf) return
  const b = place(xf, t)
  const style = child(node, 'style')
  const look = lookOf(spPr, style, colors, ctx.env.theme)
  // ponytail: a custom shape is drawn as its bounding box; add path reading if decks need it
  const geom = child(spPr, 'prstGeom')?.attrs.prst ?? 'rect'

  if (node.name === 'cxnSp' || geom === 'line' || geom === 'straightConnector1') {
    const l = look.line ?? { hex: '000000', width: 1 }
    const [x0, x1] = xf.flipH ? [b.x + b.w, b.x] : [b.x, b.x + b.w]
    const [y0, y1] = xf.flipV ? [b.y + b.h, b.y] : [b.y, b.y + b.h]
    ctx.out.push({ kind: 'line', x0, y0, x1, y1, color: l.hex, width: l.width, dash: l.dash })
    return
  }

  const tx = child(node, 'txBody')
  const body = bodyAttrs(child(tx, 'bodyPr'), layoutSp, masterSp)
  const fontRefColor = resolveColor(child(style, 'fontRef')?.children[0], colors)?.hex
  const text: TextCtx = {
    env: ctx.env,
    colors,
    levels: textLevels(ctx.env, child(tx, 'lstStyle'), layoutSp, masterSp, ph),
    slideNumber: ctx.slideNumber,
    styleColor: fontRefColor,
    defaultColor: resolveColor({ name: 'schemeClr', attrs: { val: 'tx1' }, children: [], text: '' }, colors)?.hex,
    fontScale: body.fontScale,
  }
  const paras = tx ? paragraphs(tx, text) : []
  if (!paras.length && !look.fill && !look.line) return
  const box: SlideBox = {
    kind: 'text', ...b, paragraphs: paras, anchor: body.anchor, wrap: body.wrap, insets: body.insets,
    fill: look.fill?.hex, fillAlpha: look.fill && look.fill.alpha < 1 ? look.fill.alpha : undefined,
    line: look.line ? { color: look.line.hex, width: look.line.width, dash: look.line.dash } : undefined,
    geometry: geom, rotation: xf.rot || undefined,
    fontScale: body.fontScale !== 1 ? body.fontScale : undefined, lineReduction: body.lineReduction || undefined,
  }
  ctx.out.push(box)
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

function readTable(ctx: Ctx, tbl: XmlNode, b: { x: number; y: number; w: number; h: number }): SlideTable {
  const colors: ColorContext = { theme: ctx.env.theme, clrMap: ctx.env.clrMap }
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
      const fillNode = pc?.children.find((x) => ['solidFill', 'noFill'].includes(x.name))
      const fill = fillNode ? (fillNode.name === 'solidFill' ? resolveColor(fillNode, colors)?.hex : undefined) : merged.fill
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
        env: ctx.env, colors, slideNumber: ctx.slideNumber, fontScale: 1, styleColor: merged.color, defaultColor: resolveColor({ name: 'schemeClr', attrs: { val: 'tx1' }, children: [], text: '' }, colors)?.hex, defaultBold: merged.bold, defaultSize: 18,
        levels: (lvl) => [undefined, child(ctx.env.defaultText, `lvl${lvl + 1}pPr`)], // the first slot is the shape's own list style, which a cell has none of
      }
      const anchor = pc?.attrs.anchor
      row.push({
        paragraphs: paragraphs(child(tc, 'txBody'), text),
        cols: num(tc, 'gridSpan', 1) > 1 ? num(tc, 'gridSpan') : undefined,
        rows: num(tc, 'rowSpan', 1) > 1 ? num(tc, 'rowSpan') : undefined,
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

/** a slide's background: a colour, or a picture (read from the part that holds it) */
function background(part: Part | undefined, env: Env): Pick<Slide, 'background' | 'backgroundPicture'> | undefined {
  const bg = dig(part?.root, 'cSld', 'bg')
  if (!bg || !part) return undefined
  const colors: ColorContext = { theme: env.theme, clrMap: env.clrMap }
  const pr = child(bg, 'bgPr')
  const ref = child(bg, 'bgRef')
  const fill = pr?.children.find((c) => ['solidFill', 'gradFill', 'blipFill', 'noFill', 'pattFill'].includes(c.name))
  if (fill?.name === 'solidFill') return { background: resolveColor(fill, colors)?.hex }
  if (fill?.name === 'gradFill') return { background: resolveColor(dig(fill, 'gsLst', 'gs')?.children[0], colors)?.hex }
  if (fill?.name === 'blipFill') {
    const rel = part.rels.get(child(fill, 'blip')?.attrs.embed ?? '')
    const data = rel ? env.bytes(rel.part) : undefined
    const ext = rel?.part.split('.').pop()?.toLowerCase()
    if (rel && data) return { backgroundPicture: { bytes: data, type: ext === 'png' ? 'png' : ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : 'other', name: rel.part } }
  }
  if (ref) return { background: resolveColor(ref.children[0], colors)?.hex }
  return undefined
}

/** every slide of a presentation, in order; hidden slides are marked */
export async function readPptx(bytes: Uint8Array): Promise<Deck> {
  const parts = await unzip(bytes)
  if (parts.has('EncryptedPackage')) throw new UserError('This presentation is password protected. Remove the password in PowerPoint, then try again.')
  const xml = (name: string) => {
    const b = parts.get(name)
    return b ? parseXml(new TextDecoder().decode(b)) : undefined
  }
  const relsFile = (name: string) => readRels(xml(relsOf(name)), name)
  const root = readRels(xml('_rels/.rels'), '')
  const presPath = [...root.values()].find((r) => r.type.endsWith('/officeDocument'))?.part
  const pres = presPath ? xml(presPath) : undefined
  if (!presPath || !pres || pres.name !== 'presentation') throw new UserError("This isn't a PowerPoint presentation (.pptx). Older .ppt files must be saved as .pptx first.")
  const presRels = relsFile(presPath)
  const size = child(pres, 'sldSz')
  const width = pt(num(size, 'cx', 9144000))
  const height = pt(num(size, 'cy', 5143500))
  const masterPath = [...presRels.values()].find((r) => r.type.endsWith('/slideMaster'))?.part
  const masterRoot = masterPath ? xml(masterPath) : undefined
  const masterRels = masterPath ? relsFile(masterPath) : new Map<string, Rel>()
  const themePath = [...masterRels.values()].find((r) => r.type.endsWith('/theme'))?.part
  const themeRoot = themePath ? xml(themePath) : undefined
  const theme = themeRoot ? readTheme(themeRoot) : DEFAULT_THEME
  const clrMapNode = child(masterRoot, 'clrMap')
  const clrMap = clrMapNode ? clrMapNode.attrs : { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }
  const tsPath = [...presRels.values()].find((r) => r.type.endsWith('/tableStyles'))?.part
  const tableStyles = new Map<string, XmlNode>()
  for (const s of kids(tsPath ? xml(tsPath) : undefined, 'tblStyle')) if (s.attrs.styleId) tableStyles.set(s.attrs.styleId, s)
  const env: Env = {
    xml, bytes: (n) => parts.get(n), theme, clrMap,
    masterStyles: { title: dig(masterRoot, 'txStyles', 'titleStyle'), body: dig(masterRoot, 'txStyles', 'bodyStyle'), other: dig(masterRoot, 'txStyles', 'otherStyle') },
    defaultText: child(pres, 'defaultTextStyle'),
    tableStyles,
    budget: { shapes: MAX_SHAPES },
  }
  const master: Part | undefined = masterPath && masterRoot ? { name: masterPath, root: masterRoot, rels: masterRels } : undefined

  const slides: Slide[] = []
  const ids = kids(child(pres, 'sldIdLst'), 'sldId')
  for (const [i, id] of ids.entries()) {
    const rel = presRels.get(id.attrs.id ?? '')
    const root = rel ? xml(rel.part) : undefined
    if (!rel || !root || root.name !== 'sld') continue
    const rels = relsFile(rel.part)
    const layoutPath = [...rels.values()].find((r) => r.type.endsWith('/slideLayout'))?.part
    const layoutRoot = layoutPath ? xml(layoutPath) : undefined
    const slide: Part = { name: rel.part, root, rels }
    const layout: Part | undefined = layoutPath && layoutRoot ? { name: layoutPath, root: layoutRoot, rels: relsFile(layoutPath) } : undefined
    const shapes: SlideShape[] = []
    const draw = (part: Part | undefined, decoration: boolean) => {
      const tree = dig(part?.root, 'cSld', 'spTree')
      if (!part || !tree) return
      // shapes of the layout and master use their own relationships (pictures), so they are read as if from their part
      const ctx: Ctx = { env, slide: part, layout, master, slideNumber: i + 1, out: shapes, decoration }
      for (const c of tree.children) if (['sp', 'pic', 'cxnSp', 'grpSp', 'graphicFrame'].includes(c.name)) addShape(ctx, c, IDENT)
    }
    if (root.attrs.showMasterSp !== '0' && layoutRoot?.attrs.showMasterSp !== '0') draw(master, true)
    if (root.attrs.showMasterSp !== '0') draw(layout, true)
    draw(slide, false)
    const bg = background(slide, env) ?? background(layout, env) ?? background(master, env)
    slides.push({ ...bg, shapes, hidden: root.attrs.show === '0' })
  }
  if (!slides.length) throw new UserError('This presentation has no slides that can be read.')
  return { width, height, slides }
}
