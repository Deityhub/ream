// Read a Word document (.docx) into a DocModel for the preview: paragraphs with their runs, styles (with basedOn chains
// and document defaults) and lists worked out, tables, pictures in the flow or placed on the page, text boxes, sections
// and page breaks. Not read: headers and footers, footnotes, comments, tracked changes (insertions are kept, deletions
// dropped), fields' codes (their shown result is kept), columns, floating tables' positions and shapes other than pictures
// and text boxes.
import { UserError, unzip } from '@ream/core'
import type { Block, DocModel, Paragraph, Picture, Run, Section, Table, TableCell } from './docx-model.ts'
import { DEFAULT_THEME, readRels, readTheme, relsOf, type Theme } from './ooxml.ts'
import { child, kids, num, parseXml, type XmlNode } from './xml.ts'

const tw = (v: number) => v / 20
const emu = (v: number) => v / 12700
const off = (v: string | undefined) => v === '0' || v === 'false' || v === 'off' || v === 'none'
const MAX_BLOCKS = 200_000

type Style = { type: string; basedOn?: string; pPr?: XmlNode; rPr?: XmlNode; tblPr?: XmlNode }

const HIGHLIGHT: Record<string, string> = { yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0', black: '000000', white: 'FFFFFF' }
// the usual symbol-font bullets as plain characters
const SYMBOL_BULLET: Record<string, string> = { '': '•', '': '▪', '': '➢', '': '❖', '': '✓', '': '○', o: '○', '§': '▪', '·': '•' }

type Env = {
  styles: Map<string, Style>
  defaults: { pPr?: XmlNode; rPr?: XmlNode }
  theme: Theme
  numbering: { nums: Map<string, string>; abstracts: Map<string, XmlNode> }
  counters: Map<string, number[]>
  rels: Map<string, { part: string; type: string }>
  bytes: (name: string) => Uint8Array | undefined
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
    size: sz ? num(sz, 'val') / 2 : 11,
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
  if (anchor) {
    const h = child(anchor, 'positionH')
    const v = child(anchor, 'positionV')
    p.at = { x: emu(Number(child(h, 'posOffset')?.text ?? 0)), y: emu(Number(child(v, 'posOffset')?.text ?? 0)) }
    p.from = { h: h?.attrs.relativeFrom === 'page' ? 'page' : 'margin', v: v?.attrs.relativeFrom === 'page' ? 'page' : v?.attrs.relativeFrom === 'margin' ? 'margin' : 'paragraph' }
    p.front = anchor.attrs.behindDoc !== '1'
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
  let breakAfter = false
  const addRuns = (container: XmlNode) => {
    for (const c of container.children) {
      if (c.name === 'r') {
        const rPr = child(c, 'rPr')
        const charStyles = styleChain(env, child(rPr, 'rStyle')?.attrs.val)
        const rPrs = [rPr, ...charStyles.map((s) => s.rPr), ...styles.map((s) => s.rPr), env.defaults.rPr]
        for (const k of c.children) {
          if (k.name === 't') runs.push(runOf(k.text, rPrs, env))
          else if (k.name === 'tab') runs.push(runOf('    ', rPrs, env))
          else if (k.name === 'br') {
            if (k.attrs.type === 'page') breakAfter = true
            else runs.push(runOf('\n', rPrs, env))
          } else if (k.name === 'drawing') {
            const pic = picture(k, env)
            if (pic) extras.push(pic)
            else textBox(k, env, extras)
          } else if (k.name === 'AlternateContent') {
            const drawing = findNode(child(k, 'Choice'), 'drawing')
            if (drawing) {
              const pic = picture(drawing, env)
              if (pic) extras.push(pic)
              else textBox(drawing, env, extras)
            }
          }
        }
      } else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'customXml'].includes(c.name)) addRuns(c)
      else if (c.name === 'sdt') {
        const content = child(c, 'sdtContent')
        if (content) addRuns(content)
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
    runs: runs.filter((r) => r.text),
    align: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : 'left',
    before: tw(Number(sp('before') ?? 0)),
    // a paragraph in a table cell ignores the document's default space after in Word's own table styles; keep what is set
    after: tw(Number(sp('after') ?? 0)),
    line: line && lineRule !== 'auto' ? tw(Number(line)) : undefined,
    lineExact: lineRule === 'exact' || undefined,
    lineFactor: line && lineRule === 'auto' ? Number(line) / 240 : undefined,
    indentLeft: tw(Number(at('left') ?? at('start') ?? 0)) || undefined,
    indentRight: tw(Number(at('right') ?? at('end') ?? 0)) || undefined,
    indentFirst: hanging ? -tw(Number(hanging)) : tw(Number(at('firstLine') ?? 0)) || undefined,
    pageBreakBefore: first(pPrs, 'pageBreakBefore') ? !off(first(pPrs, 'pageBreakBefore')!.attrs.val) : undefined,
    marker: list?.text || undefined,
    heading: undefined,
  }
  void inCell
  out.blocks.push(para, ...extras)
  if (breakAfter) out.blocks.push({ kind: 'p', runs: [], pageBreakBefore: true, after: 0, line: 0.1, lineExact: true })
  const sect = child(pPr, 'sectPr')
  if (sect) endSection(sect, out)
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

function readTable(t: XmlNode, env: Env, out: Out) {
  const tblPr = child(t, 'tblPr')
  const style = styleChain(env, child(tblPr, 'tblStyle')?.attrs.val)
  const borders = [child(tblPr, 'tblBorders'), ...style.map((s) => child(s.tblPr, 'tblBorders'))].find(Boolean)
  const hasBorders = !!borders && borders.children.some((b) => b.attrs.val && !off(b.attrs.val) && b.attrs.val !== 'nil')
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
      row.push({
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

function sectionOf(sect: XmlNode | undefined, blocks: Block[]): Section {
  const sz = child(sect, 'pgSz')
  const mar = child(sect, 'pgMar')
  return {
    width: tw(num(sz, 'w', 11906)),
    height: tw(num(sz, 'h', 16838)),
    margins: { top: tw(Math.abs(num(mar, 'top', 1440))), right: tw(num(mar, 'right', 1440)), bottom: tw(Math.abs(num(mar, 'bottom', 1440))), left: tw(num(mar, 'left', 1440)) },
    blocks,
  }
}

function endSection(sect: XmlNode, out: Out) {
  out.sections.push(sectionOf(sect, out.blocks))
  out.blocks = []
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
    if (s.attrs.styleId) styles.set(s.attrs.styleId, { type: s.attrs.type ?? '', basedOn: child(s, 'basedOn')?.attrs.val, pPr: child(s, 'pPr'), rPr: child(s, 'rPr'), tblPr: child(s, 'tblPr') })
  }
  const defaults = { pPr: child(child(child(stylesXml, 'docDefaults'), 'pPrDefault'), 'pPr'), rPr: child(child(child(stylesXml, 'docDefaults'), 'rPrDefault'), 'rPr') }
  const numXml = partOf('/numbering') ? xml(partOf('/numbering')!) : undefined
  const abstracts = new Map<string, XmlNode>()
  for (const a of kids(numXml, 'abstractNum')) if (a.attrs.abstractNumId) abstracts.set(a.attrs.abstractNumId, a)
  const nums = new Map<string, string>()
  for (const n of kids(numXml, 'num')) if (n.attrs.numId) nums.set(n.attrs.numId, child(n, 'abstractNumId')?.attrs.val ?? '')
  const themePart = partOf('/theme')
  const env: Env = {
    styles, defaults,
    theme: themePart && xml(themePart) ? readTheme(xml(themePart)) : DEFAULT_THEME,
    numbering: { nums, abstracts },
    counters: new Map(),
    rels,
    bytes: (n) => parts.get(n),
    budget: { blocks: MAX_BLOCKS },
  }
  const out: Out = { blocks: [], sections: [] }
  const body = child(doc, 'body')
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === 'p') readParagraph(c, env, out)
      else if (c.name === 'tbl') readTable(c, env, out)
      else if (c.name === 'sdt') { const content = child(c, 'sdtContent'); if (content) walk(content) }
    }
  }
  if (body) walk(body)
  out.sections.push(sectionOf(child(body, 'sectPr'), out.blocks))
  return { sections: out.sections.filter((s, i) => s.blocks.length || i === out.sections.length - 1) }
}
