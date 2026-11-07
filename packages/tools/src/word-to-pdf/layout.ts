// A page layout of a Word document, for its preview and for Word to PDF: paragraphs flow down the page and break between
// lines (never leaving one line alone at the top or bottom of a page, keeping lines and headings with what follows when
// the document says so), tables break between rows, pictures sit in the text or where they are placed, text boxes where
// they are. Headers and footers repeat on every page with their page numbers, links are clickable and headings are
// bookmarks. It uses the slide text engine for lines.
import { PageDraw, PdfDrawing, type OutlineItem } from '@ream/pdf-core'
import { numberText, type DocModel, type DocSection, type DocBlock, type DocTable as Table, type Paragraph, type Picture, type SlidePara } from '@ream/office-core'
import type { FontBook, FontNeed } from '../fonts/book.ts'
import { hexRgb } from '../office-fonts.ts'
import { drawText, layoutText, textHeight, type Laid, type RunBox, type Slot } from '../powerpoint-to-pdf/text.ts'

export type ImageFor = (p: Picture) => number | null

/** the slide engine's paragraph for a Word paragraph; a picture in a line is kept within `maxHeight` (a page's worth) */
export function slidePara(p: Paragraph, maxHeight = Infinity, defaultTab?: number, refs?: Map<string, string>): SlidePara {
  const fit = (pic: Picture): Picture => (pic.height > maxHeight ? { ...pic, width: (pic.width * maxHeight) / pic.height, height: maxHeight } : pic)
  return {
    runs: p.runs.map((r) => ({ ...r, text: r.field === 'pageref' && r.ref && refs?.has(r.ref) ? refs.get(r.ref)! : r.text, picture: r.picture && fit(r.picture), baseline: r.vertAlign === 'super' ? 0.3 : r.vertAlign === 'sub' ? -0.25 : undefined })),
    tabStops: p.tabStops,
    defaultTab,
    align: p.align,
    bullet: p.marker,
    marginLeft: p.indentLeft,
    indent: p.indentFirst,
    // ponytail: "at least" spacing is drawn as exactly that height; a line with bigger type than it is not let grow
    line: p.line,
    lineFactor: p.line ? undefined : (p.lineFactor ?? 1) * 0.97, // Word's single spacing of Calibri-like faces is about 1.17 em
    before: p.before ?? 0,
    after: p.after ?? 0,
    size: p.runs[0]?.size ?? 11,
  }
}

const paragraphsOf = (b: DocBlock): Paragraph[] => (b.kind === 'p' ? [b] : b.kind === 'table' ? b.rows.flat().flatMap((c) => c.paragraphs) : [])

/** every picture the document draws: in the flow, placed, in a line of text, in a table, header or footer */
export function picturesOf(doc: DocModel): Picture[] {
  const out: Picture[] = []
  for (const s of doc.sections) {
    for (const blocks of [s.blocks, s.header, s.footer, s.firstHeader, s.firstFooter]) {
      for (const b of blocks ?? []) {
        if (b.kind === 'picture') out.push(b)
        else for (const p of paragraphsOf(b)) for (const r of p.runs) if (r.picture) out.push(r.picture)
      }
    }
  }
  return out
}

/** every font the document's text asks for, headers and footers included */
export const fontNeeds = (doc: DocModel): FontNeed[] => {
  const out: FontNeed[] = []
  for (const s of doc.sections) {
    for (const b of [...s.blocks, ...(s.header ?? []), ...(s.footer ?? []), ...(s.firstHeader ?? []), ...(s.firstFooter ?? [])]) {
      for (const p of paragraphsOf(b)) for (const r of p.runs) out.push({ name: r.font, bold: r.bold, italic: r.italic, text: r.text + (r.field ? '0123456789' : '') + (p.marker ?? '') })
    }
  }
  return out
}

/** a picture in its box: all of it, or what its crop leaves (the whole picture is drawn larger or smaller and the box clips it) */
function drawPicture(page: PageDraw, id: number, p: Picture, x: number, y: number, w: number, h: number) {
  const c = p.crop
  if (!c) return page.image(id, x, y, w, h)
  const [full, high] = [w / (1 - c.l - c.r), h / (1 - c.t - c.b)]
  page.save()
  page.clip(x, y, w, h)
  page.image(id, x - c.l * full, y - c.t * high, full, high)
  page.restore()
}

const CELL_PAD = { top: 0, right: 5.4, bottom: 0, left: 5.4 } // Word's default cell margins
/** the least width Word will put text in beside a picture; a narrower gap is left empty and the line goes below */
const MIN_BESIDE = 36

/** the room a placed picture takes on its page, with the clearance the document asks for, and how text goes around it */
type Float = { x0: number; y0: number; x1: number; y1: number; kind: 'square' | 'topBottom'; side: 'both' | 'left' | 'right' | 'largest' }

/** a page of the drawing and what decides its header, footer and body; `number` is its page number and `label` how that is written */
type PageInfo = { page: PageDraw; s: DocSection; first: boolean; number: number; label: string }

/** what every part of the layout shares */
type Ctx = { d: PdfDrawing; book: FontBook; imageFor: ImageFor; pages: PageInfo[]; marks: Mark[]; doc: DocModel; /** a note's lines at a width, kept */ noteLaid: Map<string, Laid[]>
  /** where each bookmark is (page from 0, and how far down), what the links to bookmarks are waiting for, the page label of each bookmark as the last pass found it, and the page each PageDraw is */
  anchors: Map<string, { page: number; y: number }>
  links: { page: number; x: number; y: number; w: number; h: number; name: string }[]
  refs: Map<string, string>
  index: Map<PageDraw, number>
}

/** room above the notes of a page for the short rule that sets them off */
const NOTE_RULE = 10
/** a heading as laid out: its level, text and where it is */
type Mark = { level: number; title: string; page: number; y: number }

/** the blocks with the page number (as it is written on the page) and the number of pages put in where the document has those fields */
function numbered(blocks: DocBlock[], label: string, total: number): DocBlock[] {
  const para = (p: Paragraph): Paragraph => (p.runs.some((r) => r.field) ? { ...p, runs: p.runs.map((r) => (r.field === 'page' ? { ...r, text: label } : r.field === 'pages' ? { ...r, text: String(total) } : r)) } : p)
  return blocks.map((b) => (b.kind === 'p' ? para(b) : b.kind === 'table' ? { ...b, rows: b.rows.map((row) => row.map((c) => ({ ...c, paragraphs: c.paragraphs.map(para) }))) } : b))
}

/** the header or footer a page shows: the first page's when the section has one, an even page's when the document has them, else the usual one */
function bandOf(s: DocSection, info: { first: boolean; number: number }, which: 'header' | 'footer', evenAndOdd: boolean | undefined): DocBlock[] {
  const head = which === 'header'
  if (s.titlePg && info.first) return (head ? s.firstHeader : s.firstFooter) ?? []
  if (evenAndOdd && info.number % 2 === 0) return (head ? s.evenHeader : s.evenFooter) ?? []
  return (head ? s.header : s.footer) ?? []
}

/** the footnotes whose marks are in a line of laid out text */
const refsOf = (line: Laid['lines'][number]): string[] => line.pieces.flatMap((p) => (p.run.note?.kind === 'foot' ? [p.run.note.id] : []))

class Flow {
  d: PdfDrawing
  s: DocSection
  page!: PageDraw
  y = 0
  /** the body's top and bottom on this page (a tall header or footer pushes them in) */
  top: number
  bottom: number
  book: FontBook
  imageFor: ImageFor
  /** a header or footer: it never breaks to a new page, and its tabs are placed */
  band: boolean
  ctx: Ctx
  pages: PageInfo[]
  marks: Mark[]
  /** pictures on this page that text goes around (a new page has none; a header's only move the header's text) */
  floats: Float[] = []
  /** the footnotes whose marks are on this page, in order, the room they take at its bottom (with the rule), and where the body would end without them */
  notes: { ids: string[]; total: number }[] = [{ ids: [], total: 0 }]
  baseBottom = 0
  /** the lowest the body may go because a section's columns are being balanced (the room the notes of a column take comes off the page's bottom) */
  cap = Infinity
  get noteTotal() { return this.notes[this.colIndex]?.total ?? 0 }
  /** the body ends above the footnotes of the column being filled, and above the cap */
  private setBottom() {
    this.bottom = Math.min(this.baseBottom - this.noteTotal, this.cap)
  }
  /** the columns text runs in on this page (one, usually): where each starts and how wide; the one being filled; how far down any of them got; and whether the section's own first page is still to be made */
  cols: { x: number; w: number }[] = []
  colIndex = 0
  maxY = 0
  private fresh = true
  constructor(ctx: Ctx, s: DocSection, band = false) {
    this.ctx = ctx
    this.d = ctx.d
    this.s = s
    this.book = ctx.book
    this.imageFor = ctx.imageFor
    this.pages = ctx.pages
    this.marks = ctx.marks
    this.band = band
    this.top = s.margins.top
    this.bottom = band ? Infinity : s.height - s.margins.bottom
    this.layoutCols()
    if (!band) this.newPage()
  }
  get left() { return this.band ? this.s.margins.left : this.cols[this.colIndex].x }
  get width() { return this.band ? this.s.width - this.s.margins.left - this.s.margins.right : this.cols[this.colIndex].w }

  /** where the columns of the section are: one the width of the text, or what the section sets */
  private layoutCols() {
    const m = this.s.margins
    const text = this.s.width - m.left - m.right
    const c = this.s.columns
    if (!c || c.widths.length < 2) this.cols = [{ x: m.left, w: text }]
    else {
      let x = m.left
      this.cols = c.widths.map((w, i) => {
        const col = { x, w }
        x += w + (c.space[i] ?? 0)
        return col
      })
    }
    this.colIndex = 0
  }

  /** the rules between the columns, for the part of the page they were used on */
  private colRules() {
    const c = this.s.columns
    if (this.band || !c?.line || this.cols.length < 2 || !this.page) return
    const bottom = Math.max(this.maxY, this.y)
    if (bottom <= this.top + 1) return
    for (let i = 0; i < this.cols.length - 1; i++) {
      const x = this.cols[i].x + this.cols[i].w + (c.space[i] ?? 0) / 2
      this.page.line(x, this.top, x, bottom, 0.5, [0, 0, 0])
    }
  }

  /** the section is done: the next one starts below the tallest of its columns */
  endSection() {
    if (this.band) return
    this.maxY = Math.max(this.maxY, this.y)
    if (this.cols.length > 1) this.y = this.maxY
    this.colRules()
    this.colIndex = 0
    this.maxY = this.y
    // the cap that balanced the columns ends with the section
    this.cap = Infinity
    this.setBottom()
  }

  /**
   * A section starts: on the next page (after a blank one if it must start on an odd or even page), or, if it is continuous,
   * right here, with its own columns from the current height.
   */
  beginSection(s: DocSection) {
    this.s = s
    const was = this.notes
    this.layoutCols()
    if (s.type === 'continuous') {
      // the notes already on the page stay, by column; the ones of columns that are no more join the last
      this.notes = this.cols.map((_, i) => was[i] ?? { ids: [], total: 0 })
      for (const extra of was.slice(this.cols.length)) {
        const last = this.notes[this.notes.length - 1]
        last.ids.push(...extra.ids)
        last.total += extra.total
      }
      this.top = this.y
      this.maxY = this.y
      this.floats = []
      this.setBottom()
      return
    }
    const next = s.pageStart ?? (this.pages[this.pages.length - 1]?.number ?? 0) + 1
    // a blank page first (numbered as the next page, not as the restart) when the section must start on an odd or even page and this one isn't
    if ((s.type === 'oddPage' && next % 2 === 0) || (s.type === 'evenPage' && next % 2 === 1)) {
      this.fresh = false
      this.newPage()
    }
    this.fresh = true
    this.newPage()
  }

  /** the column is full: the next one on the page, or the next page */
  advance() {
    this.maxY = Math.max(this.maxY, this.y)
    if (!this.band && this.colIndex + 1 < this.cols.length) {
      this.colIndex++
      this.y = this.top
      this.setBottom()
    } else this.newPage()
  }

  /** a column no taller than this, from here: what balancing the columns of a section does */
  capBottom(height: number) {
    this.cap = this.y + height
    this.setBottom()
  }
  newPage() {
    if (this.band) return
    this.maxY = Math.max(this.maxY, this.y)
    this.colRules()
    this.flushNotes()
    const first = this.fresh
    this.fresh = false
    this.page = this.d.addPage(this.s.width, this.s.height)
    // numbering goes on from the page before, unless the section starts it again
    const was = this.pages[this.pages.length - 1]
    const number = first && this.s.pageStart !== undefined ? this.s.pageStart : was ? was.number + 1 : 1
    const info: PageInfo = { page: this.page, s: this.s, first, number, label: numberText(number, this.s.pageFormat ?? 'decimal') }
    this.pages.push(info)
    this.ctx.index.set(this.page, this.d.pages.length - 1)
    const even = this.ctx.doc.evenAndOdd
    const [header, footer] = [bandHeight(this, bandOf(this.s, info, 'header', even)), bandHeight(this, bandOf(this.s, info, 'footer', even))]
    this.top = Math.max(this.s.margins.top, header ? (this.s.margins.header ?? 36) + header : 0)
    this.bottom = Math.min(this.s.height - this.s.margins.bottom, footer ? this.s.height - (this.s.margins.footer ?? 36) - footer : Infinity)
    this.baseBottom = this.bottom
    this.cap = Infinity
    this.y = this.top
    this.maxY = this.top
    this.floats = []
    this.layoutCols()
    this.notes = this.cols.map(() => ({ ids: [], total: 0 }))
  }

  /** the text engine's paragraph for one of ours, with what the document says about tabs and what the last pass found for page references */
  sp(p: Paragraph, maxHeight = Infinity): SlidePara {
    return slidePara(p, maxHeight, this.ctx.doc.defaultTab, this.ctx.refs)
  }

  get fullWidth() { return this.s.width - this.s.margins.left - this.s.margins.right }

  /** a note's text laid out across the page */
  private noteLines(id: string): Laid[] {
    const key = `${id}|${this.width}`
    let laid = this.ctx.noteLaid.get(key)
    if (!laid) {
      const paras = this.ctx.doc.notes?.[`foot:${id}`] ?? []
      laid = layoutText(paras.map((q) => this.sp(q)), Math.max(10, this.width), true, 0, this.book)
      this.ctx.noteLaid.set(key, laid)
    }
    return laid
  }

  /** the room the notes of these marks take at the bottom of the page that the ones already there and `claimed` don't (with the rule, if they are the first) */
  private noteCost(ids: string[], claimed: Set<string>): number {
    const cap = Math.max(20, (this.baseBottom - this.top) * 0.6)
    let cost = 0
    let fresh = 0
    for (const id of new Set(ids)) {
      if (this.notes[this.colIndex].ids.includes(id) || claimed.has(id) || !this.ctx.doc.notes?.[`foot:${id}`]) continue
      cost += Math.min(textHeight(this.noteLines(id)), cap)
      fresh++
    }
    return fresh && !this.notes[this.colIndex].ids.length && !claimed.size ? cost + NOTE_RULE : cost
  }

  /** the notes of these marks are on this page now: the body ends above them */
  private takeNotes(ids: string[]) {
    if (this.band) return
    const cost = this.noteCost(ids, new Set())
    const mine = this.notes[this.colIndex]
    for (const id of new Set(ids)) if (!mine.ids.includes(id) && this.ctx.doc.notes?.[`foot:${id}`]) mine.ids.push(id)
    mine.total += cost
    this.setBottom()
  }

  /** draw this page's notes at its bottom, each column's under it, below a short rule; called when the page is left */
  flushNotes() {
    if (!this.page) return
    const was = this.colIndex
    this.notes.forEach((mine, ci) => {
      if (!mine.ids.length) return
      this.colIndex = ci // the width of the notes is the column's
      const { x, w } = this.cols[ci]
      let y = this.baseBottom - mine.total + 3
      this.page.line(x, y, x + Math.min(144, w / 3), y, 0.5, [0, 0, 0])
      y += NOTE_RULE - 3
      for (const id of mine.ids) {
        const laid = this.noteLines(id)
        const h = textHeight(laid)
        this.draw(laid, { x, y, w, h })
        y += h
      }
      mine.ids = []
      mine.total = 0
    })
    this.colIndex = was
  }

  /** the endnotes, one after the other under a rule, where the document ends */
  endnotes(ids: string[]) {
    // they go across the page under the text, whatever columns the last section had
    this.beginSection({ ...this.s, columns: undefined, type: 'continuous' })
    const left = this.s.margins.left
    // the rule goes with the first line of the first note: where there's no room for both, they start the next page
    const first = ids.map((id) => this.ctx.doc.notes?.[`end:${id}`]?.[0]).find(Boolean)
    const need = 2 * NOTE_RULE + (first ? (this.lines(first).lines[0]?.height ?? 12) : 12)
    if (!this.atTop() && this.y + need > this.bottom) this.advance()
    if (!this.atTop()) this.y += NOTE_RULE
    this.page.line(left, this.y, left + Math.min(144, this.fullWidth / 3), this.y, 0.5, [0, 0, 0])
    this.y += NOTE_RULE
    for (const id of ids) for (const q of this.ctx.doc.notes?.[`end:${id}`] ?? []) this.paragraph(q)
  }
  atTop() { return this.y <= this.top + 0.5 }

  /**
   * Where a line `h` tall at `y` may go: the widest piece of the text width the pictures leave (all of the wrapped ones,
   * on the side each allows), or, when no piece is wide enough, `skip`: how far down to move it to clear them.
   */
  private box(y: number, h: number, indentRight: number): Slot {
    let segs: [number, number][] = [[this.left, this.left + this.width - indentRight]]
    let skip = 0
    for (const f of this.floats) {
      if (f.y1 <= y || f.y0 >= y + h) continue
      skip = Math.max(skip, f.y1 - y)
      if (f.kind === 'topBottom') { segs = []; continue }
      segs = segs.flatMap(([a, b]): [number, number][] => {
        const left: [number, number] = [a, Math.min(b, f.x0)]
        const right: [number, number] = [Math.max(a, f.x1), b]
        if (f.side === 'left') return [left]
        if (f.side === 'right') return [right]
        if (f.side === 'largest') return left[1] - left[0] >= right[1] - right[0] ? [left] : [right]
        return [left, right]
      }).filter(([a, b]) => b - a > 0.5)
    }
    // ponytail: a line takes one piece (Word fills both sides of a picture in the middle of the text; this uses the wider)
    const best = segs.reduce<[number, number] | null>((m, g) => (!m || g[1] - g[0] > m[1] - m[0] ? g : m), null)
    if (best && (best[1] - best[0] >= MIN_BESIDE || !skip)) return { dx: best[0] - this.left, w: best[1] - best[0] }
    return { dx: 0, w: this.width - indentRight, skip: skip || 0.1 }
  }

  /** where a placed picture goes, from the offsets or the alignment it was given */
  private spot(p: Picture, anchorY: number): { x: number; y: number } {
    const [x0, x1] = p.from?.h === 'page' ? [0, this.s.width] : [this.left, this.left + this.width]
    const [y0, y1] = p.from?.v === 'page' ? [0, this.s.height] : p.from?.v === 'margin' ? [this.s.margins.top, this.s.height - this.s.margins.bottom] : [anchorY, anchorY]
    const a = p.align
    const x = a?.h === 'left' ? x0 : a?.h === 'center' ? (x0 + x1 - p.width) / 2 : a?.h === 'right' ? x1 - p.width : x0 + (p.at?.x ?? 0)
    const y = a?.v === 'top' ? y0 : a?.v === 'center' ? (y0 + y1 - p.height) / 2 : a?.v === 'bottom' ? y1 - p.height : y0 + (p.at?.y ?? 0)
    return { x, y }
  }

  /** a placed picture drawn where it goes */
  private paint(p: Picture, x: number, y: number) {
    const id = this.imageFor(p)
    if (id !== null) drawPicture(this.page, id, p, x, y, p.width, p.height)
  }

  /** when text wraps around a placed picture, the lines that follow keep clear of it */
  private reserve(p: Picture, x: number, y: number) {
    if (!p.wrap) return
    const d = p.dist ?? { top: 0, bottom: 0, left: 0, right: 0 }
    this.floats.push({ x0: x - d.left, y0: y - d.top, x1: x + p.width + d.right, y1: y + p.height + d.bottom, kind: p.wrap, side: p.wrapText ?? 'both' })
  }

  /** a placed picture that isn't anchored in a paragraph being laid out: drawn, and kept clear of */
  place(p: Picture, anchorY: number) {
    const { x, y } = this.spot(p, anchorY)
    this.paint(p, x, y)
    this.reserve(p, x, y)
  }

  /** what a run of a line needs drawn besides its text: a picture in the line (standing on the baseline), a link's box */
  onRun = (page: PageDraw) => (b: RunBox) => {
    const pic = b.run.picture
    const h = pic ? (b.width * pic.height) / pic.width : b.size * 1.05
    const y = pic ? b.baseline - h : b.baseline - b.size * 0.85
    if (pic) {
      const id = this.imageFor(pic)
      if (id !== null) drawPicture(page, id, pic, b.x, b.baseline - h, b.width, h)
    }
    if (b.run.link) page.link(b.x, y, b.width, h, b.run.link)
    else if (b.run.anchor) {
      const at = this.ctx.index.get(page)
      if (at !== undefined) this.ctx.links.push({ page: at, x: b.x, y, w: b.width, h, name: b.run.anchor })
    }
  }
  private draw(laid: Laid[], area: { x: number; y: number; w: number; h: number }) {
    drawText(this.page, laid, area, 'top', this.onRun(this.page))
  }

  /** a paragraph's lines, laid out for the text width */
  lines(p: Paragraph): Laid {
    const right = p.indentRight ?? 0
    // the lines are shaped for where the paragraph starts now (ponytail: one that widow control moves to the next page keeps its shape)
    const full = { dx: 0, w: this.width - right }
    // a line that would not fit starts the next page, where this page's pictures are not
    const slot = this.floats.length ? (offset: number, h: number) => (this.y + offset + h > this.bottom + 0.01 ? full : this.box(this.y + offset, h, right)) : undefined
    return layoutText([{ ...this.sp(p, this.bottom - this.top), before: 0, after: 0 }], Math.max(10, this.width - right), true, 0, this.book, slot)[0]
  }

  /**
   * a paragraph in the flow, split between lines where the page ends. `placed` are the pictures anchored in it: the ones
   * behind the text or with text around them are drawn first (they are where they are on the page the paragraph starts on),
   * the ones in front after it.
   */
  paragraph(p: Paragraph, placed: Picture[] = []) {
    // an alignment tab (relative to the margins, not a stop) is placed by `tabbed`; the usual tabs by the text engine
    if (this.band && p.tabs?.some((t) => t && t.pos === undefined) && this.tabbed(p)) return
    if (p.pageBreakBefore && !this.atTop()) this.newPage()
    if (this.band || !this.atTop()) this.y += p.before ?? 0
    // a picture placed "from the paragraph" counts from the top of its text, below the space above it (the template this was
    // checked on puts a picture 13.5 pt under a 12.9 pt line that has 10 pt above it)
    let anchor = this.y
    const under = placed.filter((q) => q.wrap || !q.front)
    const over = placed.filter((q) => !q.wrap && q.front)
    // the room they take is kept before the lines are made; they are drawn (under the text) once the page the paragraph is on is settled
    let spots: { x: number; y: number }[] = []
    let painted = false
    const keep = () => {
      spots = under.map((q) => this.spot(q, anchor))
      under.forEach((q, j) => this.reserve(q, spots[j].x, spots[j].y))
    }
    keep()
    let laid = this.lines(p)
    const w = Math.max(10, this.width - (p.indentRight ?? 0))
    let all = laid.lines
    const heightOf = (l: Laid['lines'][number]) => l.height + (l.gap ?? 0)
    const total = all.reduce((h, l) => h + heightOf(l), 0)
    let i = 0
    // set when a line was moved to a new page and nothing was drawn since: the next time, the line is drawn where it is, so
    // the loop always moves on (a header can't start a new page, and a nonsense length in a file must not stop the layout)
    let moved = false
    while (i < all.length) {
      const room = this.bottom - this.y
      let n = 0
      let h = 0
      // a line with a footnote mark also needs room for the note at the bottom of the page
      let extra = 0
      const claimed = new Set<string>()
      while (i + n < all.length) {
        const marks = refsOf(all[i + n])
        const add = this.noteCost(marks, claimed)
        if (h + heightOf(all[i + n]) + extra + add > room + 0.01) break
        h += heightOf(all[i + n])
        extra += add
        for (const id of marks) claimed.add(id)
        n++
      }
      const left = all.length - i
      // starting on a new page: the paragraph is laid out again there, where the pictures of the old page are not
      const restart = () => {
        this.advance()
        anchor = this.y
        keep()
        laid = this.lines(p)
        all = laid.lines
      }
      if (n < left) {
        // the paragraph doesn't fit: keep it whole (lines together), else split it so neither side is a single line (widows and orphans)
        if (p.keepLines && i === 0 && !moved && !this.atTop() && total <= this.bottom - this.top) { moved = true; restart(); continue }
        if (p.widowControl !== false) {
          if (left - n === 1 && n > 1) n--
          if (i === 0 && n === 1) n = 0
        }
        if (n === 0) {
          if (!this.atTop() && !moved) { moved = true; if (i === 0) restart(); else this.advance(); continue }
          n = 1 // a line taller than the page still has to go somewhere
        }
      }
      if (!painted) {
        under.forEach((q, j) => this.paint(q, spots[j].x, spots[j].y))
        painted = true
      }
      for (let k = i; k < i + n; k++) {
        // the bookmark goes where the heading's first line is drawn, which is not always the page it was reached on
        if (k === 0 && p.heading && !this.band) this.marks.push({ level: p.heading, title: p.runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim(), page: this.d.pages.length - 1, y: this.y })
        // a gap above a line is there for a picture; at the top of a page it has nothing to clear
        this.takeNotes(refsOf(all[k]))
        if (k === 0 && !this.band) for (const name of p.bookmarks ?? []) this.ctx.anchors.set(name, { page: this.d.pages.length - 1, y: this.y })
        const ln = this.atTop() && all[k].gap ? { ...all[k], gap: 0 } : all[k]
        const one: Laid = { ...laid, lines: [ln], bullet: k === 0 ? laid.bullet : undefined, before: 0, after: 0 }
        this.draw([one], { x: this.left, y: this.y, w, h: ln.height })
        this.y += heightOf(ln)
      }
      moved = false
      i += n
      if (i < all.length) this.advance()
    }
    this.y += p.after ?? 0
    for (const q of over) this.place(q, anchor)
  }

  /**
   * A header or footer line with tabs: the text between tabs is placed at the tab stops (left, centred or right), the way
   * Word's built-in headers put a title on the left and a page number on the right. False when a stop isn't known.
   * ponytail: one line; the stop for each tab is the next one in order, not "the next one to the right".
   */
  tabbed(p: Paragraph): boolean {
    const stops = p.tabs!
    if (stops.includes(null)) return false
    const parts: Paragraph['runs'][] = [[]]
    for (const r of p.runs) {
      if (r.text === '\t') parts.push([])
      else parts[parts.length - 1].push(r)
    }
    if (parts.length !== stops.length + 1) return false
    const laid = parts.map((runs) => layoutText([{ ...this.sp({ ...p, runs, align: 'left', indentLeft: 0, indentFirst: 0, marker: undefined, tabStops: undefined }), before: 0, after: 0 }], 1e6, false, 0, this.book)[0])
    const height = Math.max(...laid.map((l) => l.lines.reduce((a, ln) => a + ln.height, 0)))
    if (!this.atTop()) this.y += p.before ?? 0
    laid.forEach((l, i) => {
      if (!parts[i].length) return
      const w = l.lines[0].width
      let x = this.left + (p.indentLeft ?? 0)
      if (i) {
        const stop = stops[i - 1]!
        const at = Math.min(this.width, Math.max(0, stop.pos ?? (stop.align === 'left' ? 0 : stop.align === 'center' ? this.width / 2 : this.width)))
        x = this.left + (stop.align === 'left' ? at : stop.align === 'center' ? at - w / 2 : at - w)
      }
      this.draw([l], { x, y: this.y, w: w + 1, h: height })
    })
    this.y += height + (p.after ?? 0)
    return true
  }

  /** paragraphs in a text box at a place on the page (or below the paragraph they hang from) */
  framed(group: Paragraph[], anchorY: number) {
    const f = group[0].frame!
    const x = f.from?.h === 'margin' ? this.left + f.x : f.x
    const y = f.from?.v === 'margin' ? this.s.margins.top + f.y : f.from?.v === 'paragraph' ? anchorY + f.y : f.y
    const laid = layoutText(group.map((q) => this.sp(q)), Math.max(10, f.w), true, 0, this.book)
    this.draw(laid, { x, y, w: f.w, h: f.h ?? 0 })
  }

  private pictureSize(p: Picture): [number, number] {
    const k = Math.min(1, this.width / p.width)
    return [p.width * k, p.height * k]
  }

  picture(p: Picture, anchorY: number) {
    if (p.at || p.align) return this.place(p, anchorY)
    const id = this.imageFor(p)
    const [w, h] = this.pictureSize(p)
    if (this.y + h > this.bottom && !this.atTop()) this.advance()
    if (id !== null) drawPicture(this.page, id, p, this.left, this.y, w, h)
    else this.page.fillRect(this.left, this.y, w, h, [235, 235, 235])
    this.y += h
  }

  private columns(t: Table): number[] {
    const total = t.colWidths.reduce((a, b) => a + b, 0)
    const k = total > this.width ? this.width / total : 1
    // a table narrower than the text is on the left (moved by its indent), in the middle or on the right
    const room = this.width - total * k
    const start = this.left + (t.align === 'center' ? room / 2 : t.align === 'right' ? room : t.indent ?? 0)
    const xs = [start]
    for (const w of t.colWidths) xs.push(xs[xs.length - 1] + w * k)
    return xs
  }

  /** one row: its cells' boxes and text, and how tall it is */
  private row(t: Table, xs: number[], ri: number) {
    let col = 0
    const cells = t.rows[ri].map((c) => {
      const span = c.cols ?? 1
      const box = { x0: xs[col], x1: xs[Math.min(xs.length - 1, col + span)], c }
      col += span
      return box
    })
    const pad = cells.map((b) => b.c.pad ?? CELL_PAD)
    const laid = cells.map((b, i) => (b.c.vMerge === 'continue' ? [] : layoutText(b.c.paragraphs.map((p) => this.sp(p)), Math.max(4, b.x1 - b.x0 - pad[i].left - pad[i].right), true, 0, this.book)))
    const textH = laid.map((l) => l.reduce((h, p, i) => h + (i ? p.before : 0) + p.lines.reduce((a, x) => a + x.height, 0) + p.after, 0))
    const needed = textH.map((h, i) => h + pad[i].top + pad[i].bottom)
    return { cells, laid, pad, textH, h: Math.max(t.rowHeights?.[ri] ?? 0, ...needed, 12) }
  }

  /** the sides of a cell's border that are drawn, as lines: `top` and `bottom` only where the cell begins and ends (a row split across pages has the middle of its sides on both) */
  private cellLines(t: Table, c: Table['rows'][number][number], x0: number, x1: number, y0: number, y1: number, top: boolean, bottom: boolean) {
    // a cell the reader worked nothing out for has the table's plain grid, if it has one
    const hair = t.borders ? { w: 0.5, color: '000000' } : null
    const edge = c.border ?? { top: hair, right: hair, bottom: hair, left: hair }
    const line = (l: { w: number; color: string } | null, ax: number, ay: number, bx: number, by: number) => {
      if (l) this.page.line(ax, ay, bx, by, l.w, hexRgb(l.color))
    }
    line(edge.left, x0, y0, x0, y1)
    line(edge.right, x1, y0, x1, y1)
    if (top && c.vMerge !== 'continue') line(edge.top, x0, y0, x1, y0)
    if (bottom) line(edge.bottom, x0, y1, x1, y1)
  }

  /** a row at the current place: the fills, the text in the cells and the lines around them */
  private drawRow(t: Table, xs: number[], ri: number, r = this.row(t, xs, ri)) {
    const { cells, laid, pad, textH, h } = r
    if (!this.band) for (const b of cells) for (const q of b.c.paragraphs) for (const name of q.bookmarks ?? []) this.ctx.anchors.set(name, { page: this.d.pages.length - 1, y: this.y })
    cells.forEach((b, i) => {
      if (b.c.fill) this.page.fillRect(b.x0, this.y, b.x1 - b.x0, h, hexRgb(b.c.fill))
      if (laid[i].length) {
        // text in a cell taller than it goes at the top, middle or bottom of the room inside the cell's margins
        const free = Math.max(0, h - pad[i].top - pad[i].bottom - textH[i])
        const shift = b.c.vAlign === 'center' ? free / 2 : b.c.vAlign === 'bottom' ? free : 0
        this.draw(laid[i], { x: b.x0 + pad[i].left, y: this.y + pad[i].top + shift, w: b.x1 - b.x0 - pad[i].left - pad[i].right, h: textH[i] })
      }
      this.cellLines(t, b.c, b.x0, b.x1, this.y, this.y + h, true, true)
    })
    this.y += h
  }

  /**
   * A row that doesn't fit where it is, drawn in pieces: each cell takes the lines of its text that fit, the piece is drawn,
   * and what is left of the row goes on at the top of the next column or page, until every cell is out of lines.
   */
  private splitRow(t: Table, xs: number[], ri: number, r: ReturnType<Flow['row']>, repeat: () => void) {
    const { cells, laid, pad } = r
    // each cell's lines one after the other, with the space its paragraph keeps above and below
    type Item = { l: Laid; k: number; above: number; height: number; below: number }
    const items = laid.map((ls) => ls.flatMap((l, pi): Item[] => l.lines.map((ln, k) => ({ l, k, above: k === 0 && pi ? l.before : 0, height: ln.height + (ln.gap ?? 0), below: k === l.lines.length - 1 ? l.after : 0 }))))
    const at = items.map(() => 0)
    let first = true
    for (let guard = 0; guard < 10_000 && at.some((a, i) => a < items[i].length); guard++) {
      const room = this.bottom - this.y
      const take = items.map((list, i) => {
        let n = 0
        let used = 0
        while (at[i] + n < list.length) {
          const it = list[at[i] + n]
          // a line needs its own height and the space above it; what is below it only counts at the end of the paragraph
          if (used + it.above + it.height + it.below > room - pad[i].top - pad[i].bottom + 0.01) break
          used += it.above + it.height + it.below
          n++
        }
        return { n, used }
      })
      const stuck = take.every((x, i) => x.n === 0 || at[i] >= items[i].length)
      if (stuck && !this.atTop()) {
        this.advance()
        if (t.headerRows && ri >= t.headerRows) repeat()
        continue
      }
      // at the top of a page and still nothing fits: one line each goes anyway
      if (stuck) items.forEach((list, i) => { if (at[i] < list.length) take[i] = { n: 1, used: list[at[i]].above + list[at[i]].height + list[at[i]].below } })
      const pieceH = Math.max(12, ...take.map((x, i) => (x.n ? x.used + pad[i].top + pad[i].bottom : 0)))
      cells.forEach((b, i) => {
        const part = items[i].slice(at[i], at[i] + take[i].n)
        if (b.c.fill) this.page.fillRect(b.x0, this.y, b.x1 - b.x0, pieceH, hexRgb(b.c.fill))
        if (part.length) {
          // the part of each paragraph that is in this piece, with the space above kept only where the paragraph starts
          const groups: Laid[] = []
          for (const it of part) {
            let g = groups[groups.length - 1]
            if (g && g.para === it.l.para) g.lines.push(it.l.lines[it.k])
            else groups.push((g = { ...it.l, lines: [it.l.lines[it.k]], before: groups.length ? it.l.before : 0, after: 0, bullet: it.k === 0 ? it.l.bullet : undefined }))
            if (it.below) g.after = it.l.after // the space below a paragraph only where its last line is
          }
          this.draw(groups, { x: b.x0 + pad[i].left, y: this.y + pad[i].top, w: b.x1 - b.x0 - pad[i].left - pad[i].right, h: pieceH })
        }
        at[i] += take[i].n
        const done = at.every((a, j) => a >= items[j].length)
        this.cellLines(t, b.c, b.x0, b.x1, this.y, this.y + pieceH, first, done)
      })
      this.y += pieceH
      first = false
      if (at.some((a, i) => a < items[i].length)) {
        this.advance()
        if (t.headerRows && ri >= t.headerRows) repeat()
      }
    }
  }

  table(t: Table) {
    const xs = this.columns(t)
    // the heading rows come again at the top of each page the table goes on on, if there's room for them and more
    const repeatHeads = (ri: number, r: ReturnType<Flow['row']>) => () => {
      const heads = t.headerRows && ri >= t.headerRows ? Array.from({ length: t.headerRows }, (_, k) => this.row(t, xs, k)) : []
      if (heads.reduce((a, x) => a + x.h, 0) + Math.min(r.h, 40) < (this.bottom - this.top) / 2) heads.forEach((x, k) => this.drawRow(t, xs, k, x))
    }
    // a cell continued from the row above is drawn as part of it: rows are drawn one at a time, so its text stays in its first row
    t.rows.forEach((_, ri) => {
      const r = this.row(t, xs, ri)
      const marks = r.laid.flatMap((l) => l.flatMap((p) => p.lines.flatMap(refsOf)))
      const need = r.h + this.noteCost(marks, new Set())
      if (this.y + need > this.bottom) {
        // a row with text of more than a line that may be split goes on in pieces; any other starts on the next column or page
        const splittable = !t.noSplit?.[ri] && r.laid.some((l) => l.reduce((n, p) => n + p.lines.length, 0) > 1)
        if (splittable) {
          this.takeNotes(marks)
          this.splitRow(t, xs, ri, r, repeatHeads(ri, r))
          return
        }
        if (!this.atTop()) {
          this.advance()
          repeatHeads(ri, r)()
        }
      }
      this.takeNotes(marks)
      this.drawRow(t, xs, ri, r)
    })
    this.y += t.after ?? 0
  }

  /** how much room a paragraph needs (all of it, with the space around it) */
  private paragraphHeight(p: Paragraph): number {
    return (p.before ?? 0) + this.lines(p).lines.reduce((h, l) => h + l.height, 0) + (p.after ?? 0)
  }

  /** the room the start of a block needs to be worth putting at the bottom of a page: a few lines, a row, the picture */
  private headHeight(b: DocBlock): number {
    if (b.kind === 'picture') return b.at ? 0 : this.pictureSize(b)[1]
    if (b.kind === 'table') return b.rows.length ? this.row(b, this.columns(b), 0).h : 0
    if (b.frame) return 0
    const lines = this.lines(b).lines
    const k = b.keepLines ? lines.length : b.widowControl === false ? 1 : Math.min(2, lines.length)
    return (b.before ?? 0) + lines.slice(0, k).reduce((h, l) => h + l.height, 0)
  }

  /** a paragraph that keeps with the next one, with what comes after it that must stay on its page (a heading never ends a page) */
  chainHeight(blocks: DocBlock[], i: number, depth = 0): number {
    const b = blocks[i]
    if (!b) return 0
    if (b.kind === 'p' && b.keepNext && !b.frame && depth < 20) return this.paragraphHeight(b) + this.chainHeight(blocks, i + 1, depth + 1)
    return this.headHeight(b)
  }

  /** lay out a section's blocks in the flow */
  run(blocks: DocBlock[]) {
    let anchorY = this.y
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (b.kind === 'p' && b.frame) {
        const group = [b]
        while (i + 1 < blocks.length && blocks[i + 1].kind === 'p' && (blocks[i + 1] as Paragraph).frame === b.frame) group.push(blocks[++i] as Paragraph)
        this.framed(group, anchorY)
      } else if (b.kind === 'p') {
        anchorY = this.y
        // keep with the next: start a new column or page when this and the first lines after it don't fit together
        if (b.keepNext && !b.pageBreakBefore && !this.atTop()) {
          const need = this.chainHeight(blocks, i)
          if (this.y + need > this.bottom && need <= this.bottom - this.top) this.advance()
        }
        const [placed, last] = placedAfter(blocks, i)
        this.paragraph(b, placed)
        i = last
      } else if (b.kind === 'picture') this.picture(b, anchorY)
      else this.table(b)
    }
  }

  /** draw a header or footer's blocks from `y`, onto `page` */
  fill(page: PageDraw, y: number, blocks: DocBlock[]) {
    this.page = page
    this.y = y
    this.top = y
    this.floats = []
    let anchorY = y
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (b.kind === 'p' && b.frame) this.framed([b], anchorY)
      else if (b.kind === 'p') {
        anchorY = this.y
        const [placed, next] = placedAfter(blocks, i)
        this.paragraph(b, placed)
        i = next
      } else if (b.kind === 'picture') this.picture(b, anchorY)
      else this.table(b)
    }
  }
}

/** the placed pictures that follow block `i` (the reader puts the ones anchored in a paragraph right after it), and the index of the last one */
function placedAfter(blocks: DocBlock[], i: number): [Picture[], number] {
  const out: Picture[] = []
  for (let b = blocks[i + 1]; b?.kind === 'picture' && (b.at || b.align); b = blocks[i + 1]) {
    out.push(b)
    i++
  }
  return [out, i]
}

/** how tall a header or footer is, drawn onto a page that is thrown away */
function bandHeight(f: Flow, blocks: DocBlock[]): number {
  if (!blocks.length) return 0
  const scratch = new Flow(f.ctx, f.s, true)
  scratch.fill(new PageDraw(f.s.width, f.s.height), 0, numbered(blocks, '1', 1))
  return scratch.y
}

/** bookmarks for the headings: a heading goes under the nearest one above it of a lower level */
function outlineOf(marks: Mark[], heightOf: (page: number) => number): OutlineItem[] {
  const root: OutlineItem[] = []
  const stack: { level: number; item: OutlineItem }[] = []
  for (const m of marks) {
    if (!m.title) continue
    const item: OutlineItem = { title: m.title.slice(0, 250), page: m.page, fit: ['XYZ', null, Math.round(heightOf(m.page) - m.y + 2), null], open: true, children: [] }
    while (stack.length && stack[stack.length - 1].level >= m.level) stack.pop()
    ;(stack.length ? stack[stack.length - 1].item.children : root).push(item)
    stack.push({ level: m.level, item })
  }
  return root
}

/**
 * How tall each column of a section should be so that they end together (what Word does before a continuous section break):
 * the section laid out in one column to see how tall it is, then in its columns with a limit that is raised until it all fits
 * on the page. Undefined when the columns just fill the room, or no limit works.
 */
function balancedHeight(ctx: Ctx, s: DocSection, flow: Flow): number | undefined {
  const n = flow.cols.length
  if (n < 2) return undefined
  const probe = (section: DocSection, limit?: number) => {
    const sc: Ctx = { ...ctx, d: new PdfDrawing(), pages: [], marks: [], anchors: new Map(), links: [], index: new Map() }
    const f = new Flow(sc, section)
    if (limit !== undefined) f.capBottom(limit)
    f.run(s.blocks)
    return { f, pages: sc.pages.length }
  }
  const plain = { ...s, header: undefined, footer: undefined, firstHeader: undefined, firstFooter: undefined, evenHeader: undefined, evenFooter: undefined, titlePg: false, type: undefined, pageStart: undefined, height: 14400, margins: { ...s.margins, top: 0, bottom: 0, header: 0, footer: 0 } } // as tall as a page can be
  // one column of the first column's width, as tall as it needs
  const textW = s.width - s.margins.left - s.margins.right
  const tall = probe({ ...plain, columns: undefined, margins: { ...plain.margins, right: s.margins.right + textW - flow.cols[0].w } }).f
  const total = tall.y
  const room = flow.bottom - flow.y
  if (!(total > 0) || total / n >= room) return undefined
  for (let height = total / n, k = 0; k < 80; k++, height += 4) {
    if (height >= room) return undefined
    if (probe({ ...plain }, height).pages === 1) return height
  }
  return undefined
}

/** one pass over the document: every section laid out, then notes, headers and footers */
function layoutPass(ctx: Ctx): void {
  const { d, doc, pages } = ctx
  const flow = new Flow(ctx, doc.sections[0])
  doc.sections.forEach((s, si) => {
    if (si) flow.beginSection(s)
    if (s.columns && doc.sections[si + 1]?.type === 'continuous') {
      const height = balancedHeight(ctx, s, flow)
      if (height !== undefined) flow.capBottom(height)
    }
    flow.run(s.blocks)
    flow.endSection()
  })
  const flows = [flow]
  // endnotes where the document ends, in the order their marks come
  const ends = doc.sections.flatMap((sec) => sec.blocks.flatMap((b) => paragraphsOf(b).flatMap((q) => q.runs.flatMap((r) => (r.note?.kind === 'end' ? [r.note.id] : [])))))
  if (flows.length && ends.length) flows[flows.length - 1].endnotes(ends)
  for (const f of flows) f.flushNotes()
  // headers and footers last, when the number of pages is known
  const total = pages.length
  pages.forEach((info) => {
    const band = new Flow(ctx, info.s, true)
    const header = bandOf(info.s, info, 'header', doc.evenAndOdd)
    const footer = bandOf(info.s, info, 'footer', doc.evenAndOdd)
    if (header.length) band.fill(info.page, info.s.margins.header ?? 36, numbered(header, info.label, total))
    if (footer.length) {
      const h = bandHeight(band, footer)
      band.fill(info.page, info.s.height - (info.s.margins.footer ?? 36) - h, numbered(footer, info.label, total))
    }
  })
  d.outline = outlineOf(ctx.marks, (page) => d.pages[page].height)
  // links to bookmarks, now that the places are known
  for (const l of ctx.links) {
    const to = ctx.anchors.get(l.name)
    if (to) d.pages[l.page].goto(l.x, l.y, l.w, l.h, to.page, to.y)
  }
}

/** a Word document as PDF pages */
export function layoutDocx(d: PdfDrawing, doc: DocModel, book: FontBook, imageFor: ImageFor): void {
  const fresh = (refs: Map<string, string>): Ctx => ({ d, book, imageFor, pages: [], marks: [], doc, noteLaid: new Map(), anchors: new Map(), links: [], refs, index: new Map() })
  let ctx = fresh(new Map())
  layoutPass(ctx)
  // a table of contents (or any page reference) shows the page its bookmark is on: now that they're known, lay the document out again with them
  const hasRefs = doc.sections.some((sec) => sec.blocks.some((b) => paragraphsOf(b).some((q) => q.runs.some((r) => r.field === 'pageref'))))
  if (hasRefs) {
    const labels = new Map([...ctx.anchors].map(([name, a]) => [name, ctx.pages[a.page]?.label ?? '']))
    d.pages.length = 0
    ctx = fresh(labels)
    layoutPass(ctx)
  }
}
