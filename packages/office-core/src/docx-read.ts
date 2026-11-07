// Read a Word document (.docx) into a DocModel for the preview: paragraphs with their runs, styles (with basedOn chains
// and document defaults) and lists worked out, tables, pictures in the flow or placed on the page, text boxes, sections
// and page breaks, headers and footers (with their page number fields, a different first page and what a section takes from
// the one before), external hyperlinks, headings and what keeps lines and paragraphs together. Not read: footnotes,
// comments, tracked changes (insertions are kept, deletions dropped), other fields' codes (their shown result is kept),
// columns, different even pages, floating tables' positions and shapes other than pictures and text boxes.
import { UserError, unzip } from '@ream/core'
import type { Block, CellLine, DocModel, EmbeddedFont, Paragraph, Picture, Run, Section, Table, TableCell } from './docx-model.ts'
import { DEFAULT_THEME, readRels, readTheme, relsOf, type Theme } from './ooxml.ts'
import { child, kids, num, parseXml, type XmlNode } from './xml.ts'

// Lengths come from a file that may hold anything: a value that isn't a number is 0, and none is beyond 100 000 points
const LIMIT = 100_000
const pts = (v: number) => (Number.isFinite(v) ? Math.max(-LIMIT, Math.min(LIMIT, v)) : 0)
const tw = (v: number) => pts(v / 20)
const emu = (v: number) => pts(v / 12700)
const off = (v: string | undefined) => v === '0' || v === 'false' || v === 'off' || v === 'none'
const MAX_BLOCKS = 200_000

/** what a table style (or one of its conditional parts, such as the first row) sets */
type TableLook = { pPr?: XmlNode; rPr?: XmlNode; tcPr?: XmlNode; tblPr?: XmlNode }
type Style = { type: string; name?: string; basedOn?: string; pPr?: XmlNode; rPr?: XmlNode; tblPr?: XmlNode; tcPr?: XmlNode; /** a table style's parts for the first row, banded rows and so on */ parts?: Map<string, TableLook> }

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
  /** the number the next footnote or endnote mark gets, how marks are written, and the label of each note by id (the notes' text is read once the body has been) */
  notes: { next: { foot: number; end: number }; format: { foot: string; end: string }; restart: { foot: boolean; end: boolean }; labels: Map<string, string> }
  /** while the text of a footnote or endnote is read: its label (what `footnoteRef` shows) */
  noteLabel?: string
  /** while a table cell is read: what the table style sets for it, nearest first, for the paragraphs in it */
  cell?: { pPrs: XmlNode[]; rPrs: XmlNode[] }
  /** Word's compatibility mode (15 is Word 2013 and later; older ones, and files that say nothing, set a table's text on the margin and its edge outside it) */
  compat: number
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
export function numberText(n: number, fmt: string): string {
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

/** every tab stop of a paragraph: those of its style chain and defaults, a nearer level adding to them or clearing one */
function tabStopsOf(pPrs: (XmlNode | undefined)[]): NonNullable<Paragraph['tabStops']> {
  const stops = new Map<number, NonNullable<Paragraph['tabStops']>[number]>()
  for (const pr of [...pPrs].reverse()) {
    for (const t of kids(child(pr, 'tabs'), 'tab')) {
      const pos = tw(Number(t.attrs.pos))
      const val = t.attrs.val
      if (!t.attrs.pos || !Number.isFinite(pos)) continue
      if (val === 'clear') stops.delete(pos)
      else if (val !== 'bar') {
        const leader = t.attrs.leader
        stops.set(pos, {
          pos,
          align: val === 'center' ? 'center' : val === 'right' || val === 'end' ? 'right' : val === 'decimal' ? 'decimal' : 'left',
          leader: leader === 'dot' || leader === 'middleDot' ? 'dot' : leader === 'hyphen' ? 'hyphen' : leader === 'underscore' || leader === 'heavy' ? 'underscore' : undefined,
        })
      }
    }
  }
  return [...stops.values()].sort((a, b) => a.pos - b.pos)
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
  const pPrs = [pPr, ...styles.map((s) => s.pPr), ...(env.cell?.pPrs ?? []), env.defaults.pPr]
  const runs: Run[] = []
  const extras: Block[] = []
  const tabSeq: ({ ptab: 'left' | 'center' | 'right' } | 'tab')[] = []
  let breakAfter = false
  const bookmarks: string[] = []
  // fields (complex ones span runs: begin, the code, separate, the shown result, end; simple ones wrap the result)
  type Field = { code: string; shown: boolean; kind?: 'page' | 'pages' | 'pageref'; link?: string; anchor?: string; ref?: string; done: boolean }
  const fields: Field[] = []
  const classify = (f: Field) => {
    const code = f.code.trim()
    const kind = /^(PAGE|NUMPAGES|PAGEREF)\b/i.exec(code)?.[1].toUpperCase()
    f.kind = kind === 'PAGE' ? 'page' : kind === 'PAGEREF' ? 'pageref' : kind ? 'pages' : undefined
    f.ref = kind === 'PAGEREF' ? /^PAGEREF\s+"?([^"\s]+)/i.exec(code)?.[1] : undefined
    // a link to a place in the document (\l) names a bookmark and has no address
    const url = /^HYPERLINK\s+"([^"]+)"/i.exec(code)?.[1]
    const inside = /\s\\l\s+"([^"]+)"/i.exec(code)?.[1]
    f.link = url && !/\s\\l\b/i.test(code) ? url : undefined
    f.anchor = inside ?? (url && /\s\\l\b/i.test(code) && url.startsWith('#') ? url.slice(1) : undefined)
  }
  const addRuns = (container: XmlNode, link?: string, anchor?: string) => {
    for (const c of container.children) {
      if (c.name === 'r') {
        const rPr = child(c, 'rPr')
        const charStyles = styleChain(env, child(rPr, 'rStyle')?.attrs.val)
        const rPrs = [rPr, ...charStyles.map((s) => s.rPr), ...styles.map((s) => s.rPr), ...(env.cell?.rPrs ?? []), env.defaults.rPr]
        const add = (text: string) => {
          const top = fields[fields.length - 1]
          if (top && !top.shown) return // the code, not the result
          if (top?.kind) {
            // the page number is worked out when the page is drawn: keep one run for it, whatever the file saved
            if (top.done) return
            top.done = true
            runs.push(linked({ ...runOf(text, rPrs, env), field: top.kind, ref: top.ref }))
            return
          }
          runs.push(linked(runOf(text, rPrs, env)))
        }
        // where a run leads: an address, or a bookmark of this document
        const linked = (r: Run): Run => {
          const top = fields[fields.length - 1]
          const to = top?.link ?? link
          const inside = top?.anchor ?? anchor
          if (to) r.link = to
          else if (inside) r.anchor = inside
          return r
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
              if (f?.kind && !f.done) runs.push(linked({ ...runOf('1', rPrs, env), field: f.kind, ref: f.ref }))
            }
          } else if (k.name === 'instrText') {
            const top = fields[fields.length - 1]
            if (top && !top.shown) top.code += k.text
          } else if (k.name === 'footnoteReference' || k.name === 'endnoteReference') {
            // a mark gets the next number, whatever the file saved; the note's text is attached by id
            const kind = k.name === 'footnoteReference' ? 'foot' : 'end'
            const id = k.attrs.id
            if (id !== undefined) {
              const label = numberText(env.notes.next[kind]++, env.notes.format[kind])
              env.notes.labels.set(`${kind}:${id}`, label)
              runs.push({ ...runOf(label, rPrs, env), vertAlign: 'super', note: { id, kind } })
            }
          } else if (k.name === 'footnoteRef' || k.name === 'endnoteRef') {
            if (env.noteLabel) runs.push({ ...runOf(env.noteLabel, rPrs, env), vertAlign: 'super' })
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
            if (pic && !pic.at) runs.push(linked({ ...runOf('', rPrs, env), picture: pic }))
            else if (pic) extras.push(pic)
            else if (drawing) textBox(drawing, env, extras)
          }
        }
      } else if (c.name === 'hyperlink') {
        // an address outside the file; a link to a bookmark (anchor) has none
        const rel = c.attrs.id ? env.rels.get(c.attrs.id) : undefined
        addRuns(c, rel?.external ? rel.target : undefined, c.attrs.anchor)
      } else if (c.name === 'fldSimple') {
        const f: Field = { code: c.attrs.instr ?? '', shown: true, done: false }
        classify(f)
        fields.push(f)
        addRuns(c, link, anchor)
        fields.pop()
        if (f.kind && !f.done) runs.push({ ...runOf('1', [...styles.map((x) => x.rPr), env.defaults.rPr], env), field: f.kind, ref: f.ref })
      } else if (c.name === 'bookmarkStart') {
        if (c.attrs.name && c.attrs.name !== '_GoBack') bookmarks.push(c.attrs.name)
      } else if (['ins', 'smartTag', 'customXml'].includes(c.name)) addRuns(c, link, anchor)
      else if (c.name === 'sdt') {
        const content = child(c, 'sdtContent')
        if (content) addRuns(content, link, anchor)
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
    tabStops: tabSeq.length ? tabStopsOf(pPrs) : undefined,
    bookmarks: bookmarks.length ? bookmarks : undefined,
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

/** the table look flags: which of the style's special parts apply (first row, banded rows ...) */
function tableLook(tblPr: XmlNode | undefined) {
  const look = child(tblPr, 'tblLook')
  const bits = Number.parseInt(look?.attrs.val ?? '04A0', 16) || 0
  const flag = (name: string, bit: number) => (look?.attrs[name] !== undefined ? look.attrs[name] === '1' || look.attrs[name] === 'true' : !!(bits & bit))
  return { firstRow: flag('firstRow', 0x20), lastRow: flag('lastRow', 0x40), firstCol: flag('firstColumn', 0x80), lastCol: flag('lastColumn', 0x100), hBand: !flag('noHBand', 0x200), vBand: !flag('noVBand', 0x400) }
}

type Look = ReturnType<typeof tableLook>

/** the parts of a table style that apply to the cell at (row, col), the one that wins last: the whole table, bands, last and first column, last and first row, the corners */
function stylePartsFor(row: number, col: number, rows: number, cols: number, look: Look): string[] {
  const out = ['wholeTable']
  const bodyRow = row - (look.firstRow ? 1 : 0)
  const isHead = look.firstRow && row === 0
  const isFoot = look.lastRow && row === rows - 1
  const isFirstCol = look.firstCol && col === 0
  const isLastCol = look.lastCol && col === cols - 1
  if (look.vBand && !isFirstCol && !isLastCol) out.push((col - (look.firstCol ? 1 : 0)) % 2 === 0 ? 'band1Vert' : 'band2Vert')
  if (look.hBand && !isHead && !isFoot) out.push(bodyRow % 2 === 0 ? 'band1Horz' : 'band2Horz')
  if (isLastCol) out.push('lastCol')
  if (isFirstCol) out.push('firstCol')
  if (isFoot) out.push('lastRow')
  if (isHead) out.push('firstRow')
  if (isHead && isFirstCol) out.push('nwCell')
  if (isHead && isLastCol) out.push('neCell')
  if (isFoot && isFirstCol) out.push('swCell')
  if (isFoot && isLastCol) out.push('seCell')
  return out
}

/** one side of a border: a line, or null for none */
function lineOf(b: XmlNode | undefined): CellLine | undefined {
  if (!b) return undefined
  const val = b.attrs.val
  if (!val || val === 'nil' || val === 'none') return null
  const color = b.attrs.color
  return { w: Math.max(0.25, Math.min(12, num(b, 'sz', 4) / 8)), color: color && /^[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : '000000' }
}

function readTable(t: XmlNode, env: Env, out: Out) {
  const tblPr = child(t, 'tblPr')
  const style = styleChain(env, child(tblPr, 'tblStyle')?.attrs.val)
  // the table's own cell margins, else its style's
  const tableMar = margins([child(tblPr, 'tblCellMar'), ...style.map((s) => child(s.tblPr, 'tblCellMar'))].find(Boolean))
  const colWidths = kids(child(t, 'tblGrid'), 'gridCol').map((g) => tw(num(g, 'w')))
  const trs = kids(t, 'tr')
  const look = tableLook(tblPr)
  const nCols = Math.max(1, colWidths.length || Math.max(1, ...trs.map((tr) => kids(tr, 'tc').reduce((n, tc) => n + num(child(child(tc, 'tcPr'), 'gridSpan'), 'val', 1), 0))))
  /** what the style says for a kind of property at this cell, the most specific first: its parts that apply (the last of them wins), then the style as a whole */
  const sources = (kind: 'pPr' | 'rPr' | 'tcPr' | 'tblPr', parts: string[]): XmlNode[] => {
    const found: XmlNode[] = []
    for (const key of [...parts].reverse()) for (const st of style) { const n = st.parts?.get(key)?.[kind]; if (n) found.push(n) }
    for (const st of style) if (st[kind]) found.push(st[kind]!)
    return found
  }
  const tableBorders = [child(tblPr, 'tblBorders'), ...sources('tblPr', ['wholeTable']).map((n) => child(n, 'tblBorders'))].filter(Boolean) as XmlNode[]
  const rows: TableCell[][] = []
  let anyBorder = false
  trs.forEach((tr, ri) => {
    const row: TableCell[] = []
    let col = 0
    for (const tc of kids(tr, 'tc')) {
      const pr = child(tc, 'tcPr')
      const vm = child(pr, 'vMerge')
      const span = Math.max(1, num(child(pr, 'gridSpan'), 'val', 1))
      const parts = stylePartsFor(ri, col, trs.length, nCols, look)
      const tcPrs = [pr, ...sources('tcPr', parts)].filter(Boolean) as XmlNode[]
      // paragraphs in the cell take what the table style sets for it (after their own style, before the document's defaults)
      const was = env.cell
      env.cell = { pPrs: sources('pPr', parts), rPrs: sources('rPr', parts) }
      const sub: Out = { blocks: [], sections: [] }
      for (const c of tc.children) {
        if (c.name === 'p') readParagraph(c, env, sub, true)
        // ponytail: a table inside a cell is read as its paragraphs, one after the other
        else if (c.name === 'tbl') for (const p of findAll(c, 'p')) readParagraph(p, env, sub, true)
      }
      env.cell = was
      const fill = first(tcPrs, 'shd')?.attrs.fill
      // borders: the cell's own, else its style's, else the table's (the outside ones at the edges, the inside ones between cells)
      const own = tcPrs.map((x) => child(x, 'tcBorders')).filter(Boolean) as XmlNode[]
      const side = (names: string[], tableNames: string[]) => {
        for (const group of [own, tableBorders]) {
          for (const g of group) {
            const n = (group === own ? names : tableNames).map((k) => child(g, k)).find(Boolean)
            const l = lineOf(n)
            if (l !== undefined) return l
          }
        }
        return null
      }
      const lastRow = ri === trs.length - 1
      const lastCol = col + span >= nCols
      const border = {
        top: side(['top'], [ri === 0 ? 'top' : 'insideH']),
        bottom: side(['bottom'], [lastRow ? 'bottom' : 'insideH']),
        left: side(['left', 'start'], [col === 0 ? 'left' : 'insideV', ...(col === 0 ? ['start'] : [])]),
        right: side(['right', 'end'], [lastCol ? 'right' : 'insideV', ...(lastCol ? ['end'] : [])]),
      }
      if (border.top || border.bottom || border.left || border.right) anyBorder = true
      const mar = margins(child(pr, 'tcMar'))
      const va = child(pr, 'vAlign')?.attrs.val
      row.push({
        vAlign: va === 'center' || va === 'bottom' ? va : undefined,
        pad: { top: mar.top ?? tableMar.top ?? 0, right: mar.right ?? tableMar.right ?? 5.4, bottom: mar.bottom ?? tableMar.bottom ?? 0, left: mar.left ?? tableMar.left ?? 5.4 },
        paragraphs: sub.blocks.filter((b): b is Paragraph => b.kind === 'p'),
        cols: span > 1 ? span : undefined,
        vMerge: vm ? (vm.attrs.val === 'restart' ? 'restart' : 'continue') : undefined,
        fill: fill && fill !== 'auto' && /^[0-9a-f]{6}$/i.test(fill) ? fill.toUpperCase() : undefined,
        border,
      })
      col += span
    }
    rows.push(row)
  })
  const heights = trs.map((tr) => tw(num(child(child(tr, 'trPr'), 'trHeight'), 'val')))
  // rows marked as headings, from the top, repeat on each page the table continues on
  let headerRows = 0
  while (headerRows < trs.length && child(child(trs[headerRows], 'trPr'), 'tblHeader') && !off(child(child(trs[headerRows], 'trPr'), 'tblHeader')!.attrs.val)) headerRows++
  const noSplit = trs.map((tr) => {
    const c = child(child(tr, 'trPr'), 'cantSplit')
    return !!c && !off(c.attrs.val)
  })
  const jc = child(tblPr, 'jc')?.attrs.val
  const align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : undefined
  // in documents from before Word 2013 a table's text, not its edge, is on the margin: the edge is outside it by the cell's margin
  const ind = tw(num(child(tblPr, 'tblInd'), 'w')) - (align || env.compat >= 15 ? 0 : (tableMar.left ?? rows[0]?.[0]?.pad?.left ?? 5.4))
  const table: Table = { kind: 'table', colWidths: colWidths.length ? colWidths : [468], rows, borders: anyBorder, rowHeights: heights.some(Boolean) ? heights : undefined, align, indent: ind || undefined, headerRows: headerRows || undefined, noSplit: noSplit.some(Boolean) ? noSplit : undefined }
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

const PAGE_FORMATS = new Set(['decimal', 'lowerRoman', 'upperRoman', 'lowerLetter', 'upperLetter'])

/** the columns a section sets: their widths and the space after each (an equal-width set shares what the margins leave) */
function columnsOf(sect: XmlNode | undefined, text: number): Section['columns'] {
  const cols = child(sect, 'cols')
  if (!cols) return undefined
  const space = tw(num(cols, 'space', 720))
  const listed = kids(cols, 'col')
  if (listed.length > 1 && cols.attrs.equalWidth === '0') {
    const widths = listed.map((c) => Math.max(10, tw(num(c, 'w'))))
    return { widths, space: listed.map((c, i) => (i < listed.length - 1 ? tw(num(c, 'space', 720)) : 0)), line: cols.attrs.sep === '1' || cols.attrs.sep === 'true' }
  }
  const n = Math.max(1, Math.min(12, num(cols, 'num', listed.length || 1)))
  if (n === 1) return undefined
  const each = Math.max(10, (text - space * (n - 1)) / n)
  return { widths: Array(n).fill(each), space: Array.from({ length: n }, (_, i) => (i < n - 1 ? space : 0)), line: cols.attrs.sep === '1' || cols.attrs.sep === 'true' }
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
  const width = tw(num(sz, 'w', 11906))
  const margins = { top: tw(Math.abs(num(mar, 'top', 1440))), right: tw(num(mar, 'right', 1440)), bottom: tw(Math.abs(num(mar, 'bottom', 1440))), left: tw(num(mar, 'left', 1440)), header: tw(num(mar, 'header', 720)), footer: tw(num(mar, 'footer', 720)) }
  const numType = child(sect, 'pgNumType')
  const fmt = numType?.attrs.fmt
  const kind = child(sect, 'type')?.attrs.val
  return {
    width,
    height: tw(num(sz, 'h', 16838)),
    margins,
    blocks,
    header: hf('headerReference', 'default', before?.header),
    footer: hf('footerReference', 'default', before?.footer),
    firstHeader: hf('headerReference', 'first', before?.firstHeader),
    firstFooter: hf('footerReference', 'first', before?.firstFooter),
    evenHeader: hf('headerReference', 'even', before?.evenHeader),
    evenFooter: hf('footerReference', 'even', before?.evenFooter),
    titlePg: title ? !off(title.attrs.val) : undefined,
    type: kind === 'continuous' || kind === 'evenPage' || kind === 'oddPage' ? kind : undefined,
    pageStart: numType?.attrs.start !== undefined && Number.isFinite(Number(numType.attrs.start)) ? Math.max(0, Math.min(1e6, Math.round(Number(numType.attrs.start)))) : undefined,
    pageFormat: fmt && PAGE_FORMATS.has(fmt) ? (fmt as Section['pageFormat']) : undefined,
    columns: columnsOf(sect, width - margins.left - margins.right),
  }
}

function endSection(sect: XmlNode, out: Out, env: Env) {
  out.sections.push(sectionOf(sect, out.blocks, env, out.sections[out.sections.length - 1]))
  out.blocks = []
  // notes that number again in each section
  if (env.notes.restart.foot) env.notes.next.foot = 1
  if (env.notes.restart.end) env.notes.next.end = 1
}

/** the text of the notes the body refers to, by `foot:id` / `end:id`: read from their part with its own relationships */
function readNotes(env: Env, part: string | undefined, tag: 'footnote' | 'endnote', kind: 'foot' | 'end'): Record<string, Paragraph[]> {
  const root = part ? env.part(part) : undefined
  const out: Record<string, Paragraph[]> = {}
  if (!part || !root) return out
  const sub: Env = { ...env, rels: readRels(env.part(relsOf(part)), part), counters: new Map() }
  for (const note of kids(root, tag)) {
    const id = note.attrs.id
    const label = id === undefined ? undefined : env.notes.labels.get(`${kind}:${id}`)
    // separators and the like, and notes nothing refers to, are left out
    if (label === undefined || (note.attrs.type && note.attrs.type !== 'normal')) continue
    sub.noteLabel = label
    const o: Out = { blocks: [], sections: [] }
    walk(note, sub, o)
    out[`${kind}:${id}`] = o.blocks.filter((b): b is Paragraph => b.kind === 'p')
  }
  return out
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
    if (s.attrs.styleId) styles.set(s.attrs.styleId, { type: s.attrs.type ?? '', name: child(s, 'name')?.attrs.val, basedOn: child(s, 'basedOn')?.attrs.val, pPr: child(s, 'pPr'), rPr: child(s, 'rPr'), tblPr: child(s, 'tblPr'), tcPr: child(s, 'tcPr'), parts: new Map(kids(s, 'tblStylePr').map((x) => [x.attrs.type ?? '', { pPr: child(x, 'pPr'), rPr: child(x, 'rPr'), tcPr: child(x, 'tcPr'), tblPr: child(x, 'tblPr') }])) })
  }
  const defaults = { pPr: child(child(child(stylesXml, 'docDefaults'), 'pPrDefault'), 'pPr'), rPr: child(child(child(stylesXml, 'docDefaults'), 'rPrDefault'), 'rPr') }
  const numXml = partOf('/numbering') ? xml(partOf('/numbering')!) : undefined
  const abstracts = new Map<string, XmlNode>()
  for (const a of kids(numXml, 'abstractNum')) if (a.attrs.abstractNumId) abstracts.set(a.attrs.abstractNumId, a)
  const nums = new Map<string, string>()
  for (const n of kids(numXml, 'num')) if (n.attrs.numId) nums.set(n.attrs.numId, child(n, 'abstractNumId')?.attrs.val ?? '')
  const settings = partOf('/settings') ? xml(partOf('/settings')!) : undefined
  const compat = Math.max(0, ...kids(child(settings, 'compat'), 'compatSetting').filter((c) => c.attrs.name === 'compatibilityMode').map((c) => num(c, 'val', 0)))
  const evenAndOdd = child(settings, 'evenAndOddHeaders')
  const defaultTab = child(settings, 'defaultTabStop')
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
    compat: compat || 12,
    notes: {
      next: { foot: 1, end: 1 },
      format: { foot: child(child(settings, 'footnotePr'), 'numFmt')?.attrs.val ?? 'decimal', end: child(child(settings, 'endnotePr'), 'numFmt')?.attrs.val ?? 'lowerRoman' },
      restart: { foot: child(child(settings, 'footnotePr'), 'numRestart')?.attrs.val === 'eachSect', end: child(child(settings, 'endnotePr'), 'numRestart')?.attrs.val === 'eachSect' },
      labels: new Map(),
    },
  }
  const out: Out = { blocks: [], sections: [] }
  const body = child(doc, 'body')
  if (body) walk(body, env, out)
  out.sections.push(sectionOf(child(body, 'sectPr'), out.blocks, env, out.sections[out.sections.length - 1]))
  // the notes' text, now that the body has numbered the marks
  const notes = { ...readNotes(env, partOf('/footnotes'), 'footnote', 'foot'), ...readNotes(env, partOf('/endnotes'), 'endnote', 'end') }
  const fontPart = partOf('/fontTable')
  const fonts = fontPart ? embeddedFonts(xml(fontPart), readRels(xml(relsOf(fontPart)), fontPart), parts) : []
  return {
    sections: out.sections.filter((s, i) => s.blocks.length || i === out.sections.length - 1),
    ...(evenAndOdd && !off(evenAndOdd.attrs.val) ? { evenAndOdd: true } : {}),
    ...(Object.keys(notes).length ? { notes } : {}),
    ...(defaultTab ? { defaultTab: Math.max(1, tw(num(defaultTab, 'val', 720))) } : {}),
    ...(fonts.length ? { fonts } : {}),
  }
}
