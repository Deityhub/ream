// Read a Word document (.docx) into a DocModel for the preview: paragraphs with their runs, styles (with basedOn chains
// and document defaults) and lists worked out, tables, pictures in the flow or placed on the page, text boxes, sections
// and page breaks, headers and footers (with their page number fields, a different first page and what a section takes from
// the one before), external hyperlinks, headings and what keeps lines and paragraphs together. Not read: footnotes,
// comments, tracked changes (insertions are kept, deletions dropped), other fields' codes (their shown result is kept),
// columns, different even pages, floating tables' positions and shapes other than pictures and text boxes.
import { UserError, unzip } from '@ream/core'
import type { Block, DocModel, EmbeddedFont, Paragraph, Picture, Run, Section, Table, TableCell } from './docx-model.ts'
import { DEFAULT_THEME, readRels, readTheme, relsOf, type Theme } from './ooxml.ts'
import { child, kids, num, parseXml, type XmlNode } from './xml.ts'

// Lengths come from a file that may hold anything: a value that isn't a number is 0, and none is beyond 100 000 points
const LIMIT = 100_000
const pts = (v: number) => (Number.isFinite(v) ? Math.max(-LIMIT, Math.min(LIMIT, v)) : 0)
const tw = (v: number) => pts(v / 20)
const emu = (v: number) => pts(v / 12700)
const off = (v: string | undefined) => v === '0' || v === 'false' || v === 'off' || v === 'none'
const MAX_BLOCKS = 200_000

type Style = { type: string; name?: string; basedOn?: string; pPr?: XmlNode; rPr?: XmlNode; tblPr?: XmlNode }

const HIGHLIGHT: Record<string, string> = { yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0', black: '000000', white: 'FFFFFF' }
// the usual symbol-font bullets as plain characters
const SYMBOL_BULLET: Record<string, string> = { '': '•', '': '▪', '': '➢', '': '❖', '': '✓', '': '○', o: '○', '§': '▪', '·': '•' }

type Env = {
  styles: Map<string, Style>
  defaults: { pPr?: XmlNode; rPr?: XmlNode }
  theme: Theme
  numbering: { nums: Map<string, string>; abstracts: Map<string, XmlNode> }
  counters: Map<string, number[]>
  rels: Map<string, { part: string; type: string; external: boolean; target: string }>
  bytes: (name: string) => Uint8Array | undefined
  /** a part of the package as parsed XML (kept: headers are used by every section that names them) */
  part: (name: string) => XmlNode | undefined
  budget: { blocks: number }
}

/** the style and those it is based on, nearest first */
function styleChain(env: Env, id: string | undefined): Style[] {
  const out: Style[] = []
  for (let i = 0; id && i < 20; i++) {
    const s = env.styles.get(id)
    if (!s || out.includes(s)) break
    out.push(s)
    id = s.basedOn
  }
  return out
}

/** the first of these property elements that has a child `name`, and that child */
const first = (nodes: (XmlNode | undefined)[], name: string) => nodes.map((n) => child(n, name)).find(Boolean)

function fontOf(rFonts: XmlNode | undefined, theme: Theme): string | undefined {
  if (!rFonts) return undefined
  const t = rFonts.attrs.asciiTheme ?? rFonts.attrs.hAnsiTheme
  if (t) return /major/i.test(t) ? theme.major : theme.minor
  return rFonts.attrs.ascii ?? rFonts.attrs.hAnsi ?? rFonts.attrs.cs
}

function runOf(text: string, rPrs: (XmlNode | undefined)[], env: Env): Run {
  const flag = (name: string) => {
    const n = first(rPrs, name)
    return n ? !off(n.attrs.val) : undefined
  }
  const sz = first(rPrs, 'sz')
  const color = first(rPrs, 'color')?.attrs.val
  const u = first(rPrs, 'u')
  const va = first(rPrs, 'vertAlign')?.attrs.val
  const hl = first(rPrs, 'highlight')?.attrs.val ?? first(rPrs, 'shd')?.attrs.fill
  return {
    // capitals are shown, not stored
    text: flag('caps') ? text.toUpperCase() : text,
    bold: flag('b'),
    italic: flag('i'),
    underline: !!u && !off(u.attrs.val),
    size: sz ? Math.max(1, Math.min(1000, num(sz, 'val') / 2)) || 11 : 11,
    color: color && color !== 'auto' && /^[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : undefined,
    font: fontOf(first(rPrs, 'rFonts'), env.theme),
    highlight: hl && hl !== 'auto' && hl !== 'none' ? (HIGHLIGHT[hl] ?? (/^[0-9a-f]{6}$/i.test(hl) ? hl.toUpperCase() : undefined)) : undefined,
    vertAlign: va === 'superscript' ? 'super' : va === 'subscript' ? 'sub' : undefined,
  }
}

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
function numberText(n: number, fmt: string): string {
  if (fmt === 'lowerLetter' || fmt === 'upperLetter') {
    let s = ''
    for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s
    return fmt === 'upperLetter' ? s.toUpperCase() : s
  }
  if (fmt === 'lowerRoman' || fmt === 'upperRoman') {
    let s = ''
    let k = n
    for (const [v, r] of ROMAN) while (k >= v) { s += r; k -= v }
    return fmt === 'upperRoman' ? s.toUpperCase() : s
  }
  return String(n)
}

/** the list mark of a numbered or bulleted paragraph, with the indent its list level gives */
function listMark(env: Env, numPr: XmlNode | undefined): { text: string; ind?: XmlNode } | null {
  const numId = child(numPr, 'numId')?.attrs.val
  if (!numId || numId === '0') return null
  const ilvl = Math.min(8, num(child(numPr, 'ilvl'), 'val'))
  const abs = env.numbering.abstracts.get(env.numbering.nums.get(numId) ?? '')
  const lvl = kids(abs, 'lvl').find((l) => num(l, 'ilvl') === ilvl)
  if (!lvl) return null
  const fmt = child(lvl, 'numFmt')?.attrs.val ?? 'decimal'
  const ind = child(child(lvl, 'pPr'), 'ind')
  const textAttr = child(lvl, 'lvlText')?.attrs.val ?? ''
  if (fmt === 'bullet') return { text: SYMBOL_BULLET[textAttr] ?? (textAttr || '•'), ind }
  if (fmt === 'none') return { text: '', ind }
  // counters per list: this level goes up, deeper levels start again
  const c = env.counters.get(numId) ?? Array(9).fill(0)
  const start = num(child(lvl, 'start'), 'val', 1)
  c[ilvl] = c[ilvl] ? c[ilvl] + 1 : start
  for (let k = ilvl + 1; k < 9; k++) c[k] = 0
  env.counters.set(numId, c)
  const text = textAttr.replace(/%(\d)/g, (_, d: string) => {
    const k = Number(d) - 1
    const l = kids(abs, 'lvl').find((x) => num(x, 'ilvl') === k)
    return numberText(c[k] || num(child(l, 'start'), 'val', 1), child(l, 'numFmt')?.attrs.val ?? 'decimal')
  })
  return { text, ind }
}

const flagOf = (pPrs: (XmlNode | undefined)[], name: string) => {
  const n = first(pPrs, name)
  return n && !off(n.attrs.val) ? true : undefined
}

/** a heading's level: the outline level the paragraph or its style sets, else a style named "heading 1" to "heading 6" */
function headingOf(pPrs: (XmlNode | undefined)[], styles: Style[]): Paragraph['heading'] {
  const lvl = first(pPrs, 'outlineLvl')?.attrs.val
  if (lvl !== undefined) return Number(lvl) <= 5 ? ((Number(lvl) + 1) as 1) : undefined
  const named = styles.map((s) => /^heading ([1-6])$/i.exec(s.name ?? '')?.[1]).find(Boolean)
  return named ? (Number(named) as 1) : undefined
}

/** the stop for each tab character: the paragraph's tab stops in order (the first set found in the style chain), or the place an alignment tab names */
function tabsOf(seq: ({ ptab: 'left' | 'center' | 'right' } | 'tab')[], pPrs: (XmlNode | undefined)[]): NonNullable<Paragraph['tabs']> {
  const stops = kids(first(pPrs, 'tabs'), 'tab')
    .filter((t) => t.attrs.val !== 'clear' && t.attrs.pos)
    .map((t) => ({ pos: tw(Number(t.attrs.pos)), align: t.attrs.val === 'center' ? ('center' as const) : t.attrs.val === 'right' || t.attrs.val === 'end' ? ('right' as const) : ('left' as const) }))
    .sort((a, b) => a.pos - b.pos)
  let n = 0
  return seq.map((t) => (t === 'tab' ? (stops[n++] ?? null) : { align: t.ptab }))
}

type Out = { blocks: Block[]; sections: Section[] }

function picture(node: XmlNode, env: Env): Picture | null {
  const inline = child(node, 'inline')
  const anchor = child(node, 'anchor')
  const host = inline ?? anchor
  const ext = child(host, 'extent')
  const pic = findNode(host, 'pic')
  const embed = findNode(pic, 'blip')?.attrs.embed
  const rel = embed ? env.rels.get(embed) : undefined
  const bytes = rel ? env.bytes(rel.part) : undefined
  if (!ext || !rel || !bytes) return null
  const ext2 = rel.part.split('.').pop()?.toLowerCase()
  if (ext2 !== 'png' && ext2 !== 'jpeg' && ext2 !== 'jpg') return null
  const p: Picture = { kind: 'picture', bytes, type: ext2 === 'png' ? 'png' : 'jpeg', width: emu(num(ext, 'cx')), height: emu(num(ext, 'cy')), alt: child(host, 'docPr')?.attrs.descr }
  // the crop is in thousandths of a percent of the picture; what shows has to be something, and not absurdly little
  const src = findNode(pic, 'srcRect')
  if (src) {
    const [l, t, r, b] = ['l', 't', 'r', 'b'].map((k) => Math.max(-100, Math.min(0.99, Number(src.attrs[k] ?? 0) / 100000 || 0)))
    if ((l || t || r || b) && 1 - l - r > 0.01 && 1 - t - b > 0.01) p.crop = { l, t, r, b }
  }
  if (anchor) {
    const h = child(anchor, 'positionH')
    const v = child(anchor, 'positionV')
    const hAlign = child(h, 'align')?.text.trim()
    const vAlign = child(v, 'align')?.text.trim()
    p.at = { x: emu(Number(child(h, 'posOffset')?.text ?? 0)), y: emu(Number(child(v, 'posOffset')?.text ?? 0)) }
    // columns count as the margins (one column); a line, as the paragraph it is in
    const fromH = h?.attrs.relativeFrom
    const fromV = v?.attrs.relativeFrom
    p.from = { h: fromH === 'page' ? 'page' : 'margin', v: fromV === 'page' ? 'page' : fromV && /margin/i.test(fromV) ? 'margin' : 'paragraph' }
    if (hAlign || vAlign) p.align = { h: hAlign === 'left' || hAlign === 'center' || hAlign === 'right' ? hAlign : undefined, v: vAlign === 'top' || vAlign === 'center' || vAlign === 'bottom' ? vAlign : undefined }
    p.front = anchor.attrs.behindDoc !== '1'
    const wrap = anchor.children.find((c) => /^wrap(Square|Tight|Through|TopAndBottom)$/.test(c.name))
    if (wrap) {
      p.wrap = wrap.name === 'wrapTopAndBottom' ? 'topBottom' : 'square'
      const side = wrap.attrs.wrapText
      p.wrapText = side === 'left' || side === 'right' || side === 'largest' ? side : 'both'
      const d = (k: string) => emu(Number(wrap.attrs[k] ?? anchor.attrs[k] ?? 0))
      p.dist = { top: d('distT'), bottom: d('distB'), left: d('distL'), right: d('distR') }
    }
  }
  return p
}

/** the first node of that name anywhere under `n` */
function findNode(n: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!n) return undefined
  for (const c of n.children) {
    if (c.name === name) return c
    const deep = findNode(c, name)
    if (deep) return deep
  }
  return undefined
}

/** a paragraph and what it holds: its runs, and the pictures and text boxes anchored in it */
function readParagraph(p: XmlNode, env: Env, out: Out, inCell = false) {
  if (env.budget.blocks-- <= 0) throw new UserError('This document is too long to preview.')
  const pPr = child(p, 'pPr')
  const styles = styleChain(env, child(pPr, 'pStyle')?.attrs.val ?? (env.styles.has('Normal') ? 'Normal' : undefined))
  const pPrs = [pPr, ...styles.map((s) => s.pPr), env.defaults.pPr]
  const runs: Run[] = []
  const extras: Block[] = []
  const tabSeq: ({ ptab: 'left' | 'center' | 'right' } | 'tab')[] = []
  let breakAfter = false
  // fields (complex ones span runs: begin, the code, separate, the shown result, end; simple ones wrap the result)
  type Field = { code: string; shown: boolean; kind?: 'page' | 'pages'; link?: string; done: boolean }
  const fields: Field[] = []
  const classify = (f: Field) => {
    const code = f.code.trim()
    const kind = /^(PAGE|NUMPAGES)\b/i.exec(code)?.[1].toUpperCase()
    f.kind = kind === 'PAGE' ? 'page' : kind ? 'pages' : undefined
    // a link to a place in the document (\l) has no address
    const url = /^HYPERLINK\s+"([^"]+)"/i.exec(code)?.[1]
    f.link = url && !/\s\\l\b/i.test(code) ? url : undefined
  }
  const addRuns = (container: XmlNode, link?: string) => {
    for (const c of container.children) {
      if (c.name === 'r') {
        const rPr = child(c, 'rPr')
        const charStyles = styleChain(env, child(rPr, 'rStyle')?.attrs.val)
        const rPrs = [rPr, ...charStyles.map((s) => s.rPr), ...styles.map((s) => s.rPr), env.defaults.rPr]
        const add = (text: string) => {
          const top = fields[fields.length - 1]
          if (top && !top.shown) return // the code, not the result
          if (top?.kind) {
            // the page number is worked out when the page is drawn: keep one run for it, whatever the file saved
            if (top.done) return
            top.done = true
            runs.push({ ...runOf(text, rPrs, env), field: top.kind })
            return
          }
          const r = runOf(text, rPrs, env)
          const to = top?.link ?? link
          if (to) r.link = to
          runs.push(r)
        }
        for (const k of c.children) {
          if (k.name === 't') add(k.text)
          else if (k.name === 'fldChar') {
            const type = k.attrs.fldCharType
            if (type === 'begin') fields.push({ code: '', shown: false, done: false })
            else if (type === 'separate' && fields.length) { fields[fields.length - 1].shown = true; classify(fields[fields.length - 1]) }
            else if (type === 'end') {
              const f = fields.pop()
              // a page number with no result saved (Google Docs writes none) still has to be shown
              if (f?.kind && !f.done) runs.push({ ...runOf('1', rPrs, env), field: f.kind })
            }
          } else if (k.name === 'instrText') {
            const top = fields[fields.length - 1]
            if (top && !top.shown) top.code += k.text
          } else if (k.name === 'tab') { add('\t'); tabSeq.push('tab') }
          else if (k.name === 'ptab') {
            const a = k.attrs.alignment
            add('\t')
            tabSeq.push({ ptab: a === 'center' ? 'center' : a === 'right' ? 'right' : 'left' })
          } else if (k.name === 'br') {
            if (k.attrs.type === 'page') breakAfter = true
            else add('\n')
          } else if (k.name === 'drawing' || k.name === 'AlternateContent') {
            const drawing = k.name === 'drawing' ? k : findNode(child(k, 'Choice'), 'drawing')
            const pic = drawing ? picture(drawing, env) : null
            // a picture in the line is part of the paragraph's text; one placed on the page is laid out around it
            if (pic && !pic.at) runs.push({ ...runOf('', rPrs, env), picture: pic })
            else if (pic) extras.push(pic)
            else if (drawing) textBox(drawing, env, extras)
          }
        }
      } else if (c.name === 'hyperlink') {
        // an address outside the file; a link to a bookmark (anchor) has none
        const rel = c.attrs.id ? env.rels.get(c.attrs.id) : undefined
        addRuns(c, rel?.external ? rel.target : undefined)
      } else if (c.name === 'fldSimple') {
        const f: Field = { code: c.attrs.instr ?? '', shown: true, done: false }
        classify(f)
        fields.push(f)
        addRuns(c, link)
        fields.pop()
        if (f.kind && !f.done) runs.push({ ...runOf('1', [...styles.map((x) => x.rPr), env.defaults.rPr], env), field: f.kind })
      } else if (['ins', 'smartTag', 'customXml'].includes(c.name)) addRuns(c, link)
      else if (c.name === 'sdt') {
        const content = child(c, 'sdtContent')
        if (content) addRuns(content, link)
      }
    }
  }
  addRuns(p)
  const jc = first(pPrs, 'jc')?.attrs.val
  const spacing = pPrs.map((x) => child(x, 'spacing'))
  const sp = (attr: string) => spacing.find((x) => x?.attrs[attr] !== undefined)?.attrs[attr]
  const list = listMark(env, first(pPrs, 'numPr'))
  const ind = pPrs.map((x) => child(x, 'ind'))
  if (list?.ind) ind.splice(1, 0, list.ind) // the list's indent comes after the paragraph's own and before its style's
  const at = (attr: string) => ind.find((x) => x?.attrs[attr] !== undefined)?.attrs[attr]
  const lineRule = sp('lineRule') ?? 'auto'
  const line = sp('line')
  const hanging = at('hanging')
  const para: Paragraph = {
    kind: 'p',
    runs: runs.filter((r) => r.text || r.picture),
    align: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : 'left',
    before: tw(Number(sp('before') ?? 0)),
    // a paragraph in a table cell ignores the document's default space after in Word's own table styles; keep what is set
    after: tw(Number(sp('after') ?? 0)),
    line: line && lineRule !== 'auto' ? tw(Number(line)) : undefined,
    lineExact: lineRule === 'exact' || undefined,
    lineFactor: line && lineRule === 'auto' && Number.isFinite(Number(line)) ? Math.max(0.1, Math.min(20, Number(line) / 240)) : undefined,
    indentLeft: tw(Number(at('left') ?? at('start') ?? 0)) || undefined,
    indentRight: tw(Number(at('right') ?? at('end') ?? 0)) || undefined,
    indentFirst: hanging ? -tw(Number(hanging)) : tw(Number(at('firstLine') ?? 0)) || undefined,
    pageBreakBefore: first(pPrs, 'pageBreakBefore') ? !off(first(pPrs, 'pageBreakBefore')!.attrs.val) : undefined,
    marker: list?.text || undefined,
    heading: headingOf(pPrs, styles),
    keepNext: flagOf(pPrs, 'keepNext'),
    keepLines: flagOf(pPrs, 'keepLines'),
    widowControl: first(pPrs, 'widowControl') ? !off(first(pPrs, 'widowControl')!.attrs.val) : undefined,
    tabs: tabSeq.length ? tabsOf(tabSeq, pPrs) : undefined,
  }
  void inCell
  out.blocks.push(para, ...extras)
  if (breakAfter) out.blocks.push({ kind: 'p', runs: [], pageBreakBefore: true, after: 0, line: 0.1, lineExact: true })
  const sect = child(pPr, 'sectPr')
  if (sect) endSection(sect, out, env)
}

/** a text box anchored in a paragraph: its paragraphs placed where the box is */
function textBox(drawing: XmlNode, env: Env, into: Block[]) {
  const anchor = child(drawing, 'anchor')
  const content = findNode(drawing, 'txbxContent')
  if (!anchor || !content) return
  const ext = child(anchor, 'extent')
  const h = child(anchor, 'positionH')
  const v = child(anchor, 'positionV')
  const frame: Paragraph['frame'] = {
    x: emu(Number(child(h, 'posOffset')?.text ?? 0)),
    y: emu(Number(child(v, 'posOffset')?.text ?? 0)),
    w: emu(num(ext, 'cx')),
    h: emu(num(ext, 'cy')),
    from: { h: h?.attrs.relativeFrom === 'page' ? 'page' : 'margin', v: v?.attrs.relativeFrom === 'page' ? 'page' : v?.attrs.relativeFrom === 'margin' ? 'margin' : 'paragraph' },
  }
  const sub: Out = { blocks: [], sections: [] }
  for (const c of content.children) if (c.name === 'p') readParagraph(c, env, sub, true)
  for (const b of sub.blocks) if (b.kind === 'p') into.push({ ...b, frame })
}

/** cell margins from a tcMar or tblCellMar element: points per side, a side it doesn't name left to the default */
function margins(m: XmlNode | undefined): Partial<NonNullable<TableCell['pad']>> {
  const side = (...names: string[]) => {
    const n = names.map((x) => child(m, x)).find(Boolean)
    return n && n.attrs.w !== undefined ? tw(Number(n.attrs.w)) : undefined
  }
  return { top: side('top'), right: side('right', 'end'), bottom: side('bottom'), left: side('left', 'start') }
}

function readTable(t: XmlNode, env: Env, out: Out) {
  const tblPr = child(t, 'tblPr')
  const style = styleChain(env, child(tblPr, 'tblStyle')?.attrs.val)
  const borders = [child(tblPr, 'tblBorders'), ...style.map((s) => child(s.tblPr, 'tblBorders'))].find(Boolean)
  const hasBorders = !!borders && borders.children.some((b) => b.attrs.val && !off(b.attrs.val) && b.attrs.val !== 'nil')
  // the table's own cell margins, else its style's
  const tableMar = margins([child(tblPr, 'tblCellMar'), ...style.map((s) => child(s.tblPr, 'tblCellMar'))].find(Boolean))
  const colWidths = kids(child(t, 'tblGrid'), 'gridCol').map((g) => tw(num(g, 'w')))
  const rows: TableCell[][] = []
  for (const tr of kids(t, 'tr')) {
    const row: TableCell[] = []
    for (const tc of kids(tr, 'tc')) {
      const pr = child(tc, 'tcPr')
      const vm = child(pr, 'vMerge')
      const fill = child(pr, 'shd')?.attrs.fill
      const sub: Out = { blocks: [], sections: [] }
      for (const c of tc.children) {
        if (c.name === 'p') readParagraph(c, env, sub, true)
        // ponytail: a table inside a cell is read as its paragraphs, one after the other
        else if (c.name === 'tbl') for (const p of findAll(c, 'p')) readParagraph(p, env, sub, true)
      }
      const own = margins(child(pr, 'tcMar'))
      const va = child(pr, 'vAlign')?.attrs.val
      row.push({
        vAlign: va === 'center' || va === 'bottom' ? va : undefined,
        pad: { top: own.top ?? tableMar.top ?? 0, right: own.right ?? tableMar.right ?? 5.4, bottom: own.bottom ?? tableMar.bottom ?? 0, left: own.left ?? tableMar.left ?? 5.4 },
        paragraphs: sub.blocks.filter((b): b is Paragraph => b.kind === 'p'),
        cols: num(child(pr, 'gridSpan'), 'val', 1) > 1 ? num(child(pr, 'gridSpan'), 'val') : undefined,
        vMerge: vm ? (vm.attrs.val === 'restart' ? 'restart' : 'continue') : undefined,
        fill: fill && fill !== 'auto' && /^[0-9a-f]{6}$/i.test(fill) ? fill.toUpperCase() : undefined,
      })
    }
    rows.push(row)
  }
  const heights = kids(t, 'tr').map((tr) => tw(num(child(child(tr, 'trPr'), 'trHeight'), 'val')))
  const table: Table = { kind: 'table', colWidths: colWidths.length ? colWidths : [468], rows, borders: hasBorders, rowHeights: heights.some(Boolean) ? heights : undefined }
  out.blocks.push(table)
}

function findAll(n: XmlNode, name: string, into: XmlNode[] = []): XmlNode[] {
  for (const c of n.children) {
    if (c.name === name) into.push(c)
    else findAll(c, name, into)
  }
  return into
}

/** the blocks of a header or footer part, read with that part's own relationships (its pictures) */
function partBlocks(env: Env, part: string): Block[] {
  const root = env.part(part)
  if (!root) return []
  const sub: Env = { ...env, rels: readRels(env.part(relsOf(part)), part), counters: new Map() }
  const out: Out = { blocks: [], sections: [] }
  walk(root, sub, out)
  return out.blocks
}

function sectionOf(sect: XmlNode | undefined, blocks: Block[], env: Env, before?: Section): Section {
  const sz = child(sect, 'pgSz')
  const mar = child(sect, 'pgMar')
  // what a section doesn't name it takes from the one before; naming an empty one clears it
  const hf = (tag: 'headerReference' | 'footerReference', type: string, was: Block[] | undefined) => {
    const ref = kids(sect, tag).find((r) => (r.attrs.type ?? 'default') === type)
    const rel = ref?.attrs.id ? env.rels.get(ref.attrs.id) : undefined
    return rel ? partBlocks(env, rel.part) : was
  }
  const title = child(sect, 'titlePg')
  return {
    width: tw(num(sz, 'w', 11906)),
    height: tw(num(sz, 'h', 16838)),
    margins: { top: tw(Math.abs(num(mar, 'top', 1440))), right: tw(num(mar, 'right', 1440)), bottom: tw(Math.abs(num(mar, 'bottom', 1440))), left: tw(num(mar, 'left', 1440)), header: tw(num(mar, 'header', 720)), footer: tw(num(mar, 'footer', 720)) },
    blocks,
    header: hf('headerReference', 'default', before?.header),
    footer: hf('footerReference', 'default', before?.footer),
    firstHeader: hf('headerReference', 'first', before?.firstHeader),
    firstFooter: hf('footerReference', 'first', before?.firstFooter),
    titlePg: title ? !off(title.attrs.val) : undefined,
  }
}

function endSection(sect: XmlNode, out: Out, env: Env) {
  out.sections.push(sectionOf(sect, out.blocks, env, out.sections[out.sections.length - 1]))
  out.blocks = []
}

/** the paragraphs and tables under a body, header or footer element, in order */
function walk(n: XmlNode, env: Env, out: Out) {
  for (const c of n.children) {
    if (c.name === 'p') readParagraph(c, env, out)
    else if (c.name === 'tbl') readTable(c, env, out)
    else if (c.name === 'sdt') {
      const content = child(c, 'sdtContent')
      if (content) walk(content, env, out)
    }
  }
}

const MAX_FONTS = 40
const MAX_FONT_BYTES = 30_000_000

/** Word stores embedded fonts with their first 32 bytes mixed with the font's GUID (reversed); a key of zeros, or none, leaves a font as it was */
function unscramble(bytes: Uint8Array, guid: string | undefined): Uint8Array {
  const hex = (guid ?? '').replace(/[^0-9a-f]/gi, '')
  if (hex.length !== 32) return bytes
  const key = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(30 - 2 * i, 32 - 2 * i), 16))
  const out = bytes.slice()
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= key[i % 16]
  return out
}

/** the fonts the file carries: the table lists a family's regular, bold, italic and bold italic files */
function embeddedFonts(table: XmlNode | undefined, rels: Map<string, { part: string }>, parts: Map<string, Uint8Array>): EmbeddedFont[] {
  const out: EmbeddedFont[] = []
  for (const f of kids(table, 'font')) {
    for (const [tag, bold, italic] of [['embedRegular', false, false], ['embedBold', true, false], ['embedItalic', false, true], ['embedBoldItalic', true, true]] as const) {
      const e = child(f, tag)
      const raw = e?.attrs.id ? parts.get(rels.get(e.attrs.id)?.part ?? '') : undefined
      if (!e || !raw || !f.attrs.name || raw.length > MAX_FONT_BYTES || out.length >= MAX_FONTS) continue
      out.push({ name: f.attrs.name, bold, italic, bytes: unscramble(raw, e.attrs.fontKey) })
    }
  }
  return out
}

/** a Word document as sections of blocks */
export async function readDocx(bytes: Uint8Array): Promise<DocModel> {
  const parts = await unzip(bytes)
  if (parts.has('EncryptedPackage')) throw new UserError('This document is password protected. Remove the password in Word, then try again.')
  const xml = (name: string) => {
    const b = parts.get(name)
    return b ? parseXml(new TextDecoder().decode(b)) : undefined
  }
  const root = readRels(xml('_rels/.rels'), '')
  const docPath = [...root.values()].find((r) => r.type.endsWith('/officeDocument'))?.part
  const doc = docPath ? xml(docPath) : undefined
  if (!docPath || !doc || doc.name !== 'document') throw new UserError("This isn't a Word document (.docx). Older .doc files must be saved as .docx first.")
  const rels = readRels(xml(relsOf(docPath)), docPath)
  const partOf = (type: string) => [...rels.values()].find((r) => r.type.endsWith(type))?.part
  const stylesXml = partOf('/styles') ? xml(partOf('/styles')!) : undefined
  const styles = new Map<string, Style>()
  for (const s of kids(stylesXml, 'style')) {
    if (s.attrs.styleId) styles.set(s.attrs.styleId, { type: s.attrs.type ?? '', name: child(s, 'name')?.attrs.val, basedOn: child(s, 'basedOn')?.attrs.val, pPr: child(s, 'pPr'), rPr: child(s, 'rPr'), tblPr: child(s, 'tblPr') })
  }
  const defaults = { pPr: child(child(child(stylesXml, 'docDefaults'), 'pPrDefault'), 'pPr'), rPr: child(child(child(stylesXml, 'docDefaults'), 'rPrDefault'), 'rPr') }
  const numXml = partOf('/numbering') ? xml(partOf('/numbering')!) : undefined
  const abstracts = new Map<string, XmlNode>()
  for (const a of kids(numXml, 'abstractNum')) if (a.attrs.abstractNumId) abstracts.set(a.attrs.abstractNumId, a)
  const nums = new Map<string, string>()
  for (const n of kids(numXml, 'num')) if (n.attrs.numId) nums.set(n.attrs.numId, child(n, 'abstractNumId')?.attrs.val ?? '')
  const themePart = partOf('/theme')
  const partCache = new Map<string, XmlNode | undefined>()
  const env: Env = {
    styles, defaults,
    theme: themePart && xml(themePart) ? readTheme(xml(themePart)) : DEFAULT_THEME,
    numbering: { nums, abstracts },
    counters: new Map(),
    rels,
    bytes: (n) => parts.get(n),
    part: (n) => {
      if (!partCache.has(n)) partCache.set(n, xml(n))
      return partCache.get(n)
    },
    budget: { blocks: MAX_BLOCKS },
  }
  const out: Out = { blocks: [], sections: [] }
  const body = child(doc, 'body')
  if (body) walk(body, env, out)
  out.sections.push(sectionOf(child(body, 'sectPr'), out.blocks, env, out.sections[out.sections.length - 1]))
  const fontPart = partOf('/fontTable')
  const fonts = fontPart ? embeddedFonts(xml(fontPart), readRels(xml(relsOf(fontPart)), fontPart), parts) : []
  return { sections: out.sections.filter((s, i) => s.blocks.length || i === out.sections.length - 1), ...(fonts.length ? { fonts } : {}) }
}
