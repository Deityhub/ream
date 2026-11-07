// A page layout of a Word document, for its preview and for Word to PDF: paragraphs flow down the page and break between
// lines (never leaving one line alone at the top or bottom of a page, keeping lines and headings with what follows when
// the document says so), tables break between rows, pictures sit in the text or where they are placed, text boxes where
// they are. Headers and footers repeat on every page with their page numbers, links are clickable and headings are
// bookmarks. It uses the slide text engine for lines. Approximate by design: no columns, footnotes or table styles.
import { PageDraw, PdfDrawing, type OutlineItem } from '@ream/pdf-core'
import type { DocModel, DocSection, DocBlock, DocTable as Table, Paragraph, Picture, SlidePara } from '@ream/office-core'
import type { FontBook, FontNeed } from '../fonts/book.ts'
import { hexRgb } from '../office-fonts.ts'
import { drawText, layoutText, type Laid, type RunBox, type Slot } from '../powerpoint-to-pdf/text.ts'

export type ImageFor = (p: Picture) => number | null

/** the slide engine's paragraph for a Word paragraph; a picture in a line is kept within `maxHeight` (a page's worth) */
export function slidePara(p: Paragraph, maxHeight = Infinity): SlidePara {
  const fit = (pic: Picture): Picture => (pic.height > maxHeight ? { ...pic, width: (pic.width * maxHeight) / pic.height, height: maxHeight } : pic)
  return {
    // a tab in running text is a gap (header and footer tabs are placed by `Flow.tabbed`)
    runs: p.runs.map((r) => ({ ...r, text: r.text.includes('\t') ? r.text.replace(/\t/g, '    ') : r.text, picture: r.picture && fit(r.picture), baseline: r.vertAlign === 'super' ? 0.3 : r.vertAlign === 'sub' ? -0.25 : undefined })),
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

/** a page of the drawing and what decides its header, footer and body */
type PageInfo = { page: PageDraw; s: DocSection; first: boolean }
/** a heading as laid out: its level, text and where it is */
type Mark = { level: number; title: string; page: number; y: number }

/** the blocks with the page number and the number of pages put in where the document has those fields */
function numbered(blocks: DocBlock[], n: number, total: number): DocBlock[] {
  const para = (p: Paragraph): Paragraph => (p.runs.some((r) => r.field) ? { ...p, runs: p.runs.map((r) => (r.field ? { ...r, text: String(r.field === 'page' ? n : total) } : r)) } : p)
  return blocks.map((b) => (b.kind === 'p' ? para(b) : b.kind === 'table' ? { ...b, rows: b.rows.map((row) => row.map((c) => ({ ...c, paragraphs: c.paragraphs.map(para) }))) } : b))
}

/** the header or footer a page of a section shows */
const bandOf = (s: DocSection, first: boolean, which: 'header' | 'footer'): DocBlock[] => (s.titlePg && first ? (which === 'header' ? s.firstHeader : s.firstFooter) : which === 'header' ? s.header : s.footer) ?? []

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
  pages: PageInfo[]
  marks: Mark[]
  /** pictures on this page that text goes around (a new page has none; a header's only move the header's text) */
  floats: Float[] = []
  private started = false
  constructor(d: PdfDrawing, s: DocSection, book: FontBook, imageFor: ImageFor, pages: PageInfo[], marks: Mark[], band = false) {
    this.d = d
    this.s = s
    this.book = book
    this.imageFor = imageFor
    this.pages = pages
    this.marks = marks
    this.band = band
    this.top = s.margins.top
    this.bottom = band ? Infinity : s.height - s.margins.bottom
    if (!band) this.newPage()
  }
  get left() { return this.s.margins.left }
  get width() { return this.s.width - this.s.margins.left - this.s.margins.right }
  newPage() {
    if (this.band) return
    const first = !this.started
    this.started = true
    this.page = this.d.addPage(this.s.width, this.s.height)
    this.pages.push({ page: this.page, s: this.s, first })
    const [header, footer] = [bandHeight(this, bandOf(this.s, first, 'header')), bandHeight(this, bandOf(this.s, first, 'footer'))]
    this.top = Math.max(this.s.margins.top, header ? (this.s.margins.header ?? 36) + header : 0)
    this.bottom = Math.min(this.s.height - this.s.margins.bottom, footer ? this.s.height - (this.s.margins.footer ?? 36) - footer : Infinity)
    this.y = this.top
    this.floats = []
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
    if (pic) {
      const id = this.imageFor(pic)
      const h = (b.width * pic.height) / pic.width
      if (id !== null) drawPicture(page, id, pic, b.x, b.baseline - h, b.width, h)
      if (b.run.link) page.link(b.x, b.baseline - h, b.width, h, b.run.link)
      return
    }
    if (b.run.link) page.link(b.x, b.baseline - b.size * 0.85, b.width, b.size * 1.05, b.run.link)
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
    return layoutText([{ ...slidePara(p, this.bottom - this.top), before: 0, after: 0 }], Math.max(10, this.width - right), true, 0, this.book, slot)[0]
  }

  /**
   * a paragraph in the flow, split between lines where the page ends. `placed` are the pictures anchored in it: the ones
   * behind the text or with text around them are drawn first (they are where they are on the page the paragraph starts on),
   * the ones in front after it.
   */
  paragraph(p: Paragraph, placed: Picture[] = []) {
    if (this.band && p.tabs?.length && this.tabbed(p)) return
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
      while (i + n < all.length && h + heightOf(all[i + n]) <= room + 0.01) h += heightOf(all[i + n++])
      const left = all.length - i
      // starting on a new page: the paragraph is laid out again there, where the pictures of the old page are not
      const restart = () => {
        this.newPage()
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
          if (!this.atTop() && !moved) { moved = true; if (i === 0) restart(); else this.newPage(); continue }
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
        const ln = this.atTop() && all[k].gap ? { ...all[k], gap: 0 } : all[k]
        const one: Laid = { ...laid, lines: [ln], bullet: k === 0 ? laid.bullet : undefined, before: 0, after: 0 }
        this.draw([one], { x: this.left, y: this.y, w, h: ln.height })
        this.y += heightOf(ln)
      }
      moved = false
      i += n
      if (i < all.length) this.newPage()
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
    const laid = parts.map((runs) => layoutText([{ ...slidePara({ ...p, runs, align: 'left', indentLeft: 0, indentFirst: 0, marker: undefined }), before: 0, after: 0 }], 1e6, false, 0, this.book)[0])
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
    const laid = layoutText(group.map(slidePara), Math.max(10, f.w), true, 0, this.book)
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
    if (this.y + h > this.bottom && !this.atTop()) this.newPage()
    if (id !== null) drawPicture(this.page, id, p, this.left, this.y, w, h)
    else this.page.fillRect(this.left, this.y, w, h, [235, 235, 235])
    this.y += h
  }

  private columns(t: Table): number[] {
    const total = t.colWidths.reduce((a, b) => a + b, 0)
    const k = total > this.width ? this.width / total : 1
    const xs = [this.left]
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
    const laid = cells.map((b, i) => (b.c.vMerge === 'continue' ? [] : layoutText(b.c.paragraphs.map((p) => slidePara(p)), Math.max(4, b.x1 - b.x0 - pad[i].left - pad[i].right), true, 0, this.book)))
    const textH = laid.map((l) => l.reduce((h, p, i) => h + (i ? p.before : 0) + p.lines.reduce((a, x) => a + x.height, 0) + p.after, 0))
    const needed = textH.map((h, i) => h + pad[i].top + pad[i].bottom)
    return { cells, laid, pad, textH, h: Math.max(t.rowHeights?.[ri] ?? 0, ...needed, 12) }
  }

  table(t: Table) {
    const xs = this.columns(t)
    const line = (x0: number, y0: number, x1: number, y1: number) => this.page.line(x0, y0, x1, y1, 0.5, [0, 0, 0])
    // a cell continued from the row above is drawn as part of it: rows are drawn one at a time, so its text stays in its first row
    t.rows.forEach((_, ri) => {
      const { cells, laid, pad, textH, h } = this.row(t, xs, ri)
      if (this.y + h > this.bottom && !this.atTop()) this.newPage()
      cells.forEach((b, i) => {
        if (b.c.fill) this.page.fillRect(b.x0, this.y, b.x1 - b.x0, h, hexRgb(b.c.fill))
        if (laid[i].length) {
          // text in a cell taller than it goes at the top, middle or bottom of the room inside the cell's margins
          const free = Math.max(0, h - pad[i].top - pad[i].bottom - textH[i])
          const shift = b.c.vAlign === 'center' ? free / 2 : b.c.vAlign === 'bottom' ? free : 0
          this.draw(laid[i], { x: b.x0 + pad[i].left, y: this.y + pad[i].top + shift, w: b.x1 - b.x0 - pad[i].left - pad[i].right, h: textH[i] })
        }
        if (t.borders) {
          line(b.x0, this.y, b.x0, this.y + h)
          line(b.x1, this.y, b.x1, this.y + h)
          if (b.c.vMerge !== 'continue') line(b.x0, this.y, b.x1, this.y)
          line(b.x0, this.y + h, b.x1, this.y + h)
        }
      })
      this.y += h
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
  const scratch = new Flow(f.d, f.s, f.book, f.imageFor, [], [], true)
  scratch.fill(new PageDraw(f.s.width, f.s.height), 0, numbered(blocks, 1, 1))
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

/** a Word document as PDF pages */
export function layoutDocx(d: PdfDrawing, doc: DocModel, book: FontBook, imageFor: ImageFor): void {
  const pages: PageInfo[] = []
  const marks: Mark[] = []
  for (const s of doc.sections) {
    const flow = new Flow(d, s, book, imageFor, pages, marks)
    let anchorY = flow.y
    for (let i = 0; i < s.blocks.length; i++) {
      const b = s.blocks[i]
      if (b.kind === 'p' && b.frame) {
        const group = [b]
        while (i + 1 < s.blocks.length && s.blocks[i + 1].kind === 'p' && (s.blocks[i + 1] as Paragraph).frame === b.frame) group.push(s.blocks[++i] as Paragraph)
        flow.framed(group, anchorY)
      } else if (b.kind === 'p') {
        anchorY = flow.y
        // keep with the next: start a new page when this and the first lines after it don't fit together
        if (b.keepNext && !b.pageBreakBefore && !flow.atTop()) {
          const need = flow.chainHeight(s.blocks, i)
          if (flow.y + need > flow.bottom && need <= flow.bottom - flow.top) flow.newPage()
        }
        const [placed, last] = placedAfter(s.blocks, i)
        flow.paragraph(b, placed)
        i = last
      } else if (b.kind === 'picture') flow.picture(b, anchorY)
      else flow.table(b)
    }
  }
  // headers and footers last, when the number of pages is known
  const total = pages.length
  pages.forEach((info, k) => {
    const band = new Flow(d, info.s, book, imageFor, pages, marks, true)
    const header = bandOf(info.s, info.first, 'header')
    const footer = bandOf(info.s, info.first, 'footer')
    if (header.length) band.fill(info.page, info.s.margins.header ?? 36, numbered(header, k + 1, total))
    if (footer.length) {
      const h = bandHeight(band, footer)
      band.fill(info.page, info.s.height - (info.s.margins.footer ?? 36) - h, numbered(footer, k + 1, total))
    }
  })
  d.outline = outlineOf(marks, (page) => d.pages[page].height)
}
