// A simple page layout of a Word document, for its preview: paragraphs flow down the page and break between lines,
// tables break between rows, pictures sit in the text or where they are placed, text boxes where they are. It uses the
// slide text engine for lines. Approximate by design: no widow control, keep-with-next, columns, headers or footers.
import { PageDraw, PdfDrawing } from '@ream/pdf-core'
import type { DocModel, DocSection, DocTable as Table, Paragraph, Picture, SlidePara } from '@ream/office-core'
import type { FontBook, FontNeed } from '../fonts/book.ts'
import { hexRgb } from '../office-fonts.ts'
import { drawText, layoutText, type Laid } from '../powerpoint-to-pdf/text.ts'

export type ImageFor = (p: Picture) => number | null

/** the slide engine's paragraph for a Word paragraph */
export function slidePara(p: Paragraph): SlidePara {
  return {
    runs: p.runs.map((r) => ({ ...r, baseline: r.vertAlign === 'super' ? 0.3 : r.vertAlign === 'sub' ? -0.25 : undefined })),
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

/** every font the document's text asks for */
export const fontNeeds = (doc: DocModel): FontNeed[] => {
  const out: FontNeed[] = []
  const paras = (b: DocModel['sections'][number]['blocks'][number]): Paragraph[] => (b.kind === 'p' ? [b] : b.kind === 'table' ? b.rows.flat().flatMap((c) => c.paragraphs) : [])
  for (const s of doc.sections) for (const b of s.blocks) for (const p of paras(b)) for (const r of p.runs) out.push({ name: r.font, bold: r.bold, italic: r.italic, text: r.text + (p.marker ?? '') })
  return out
}

const CELL_PAD = 5.4 // Word's default left and right cell margin

class Flow {
  d: PdfDrawing
  s: DocSection
  page!: PageDraw
  y = 0
  book: FontBook
  imageFor: ImageFor
  constructor(d: PdfDrawing, s: DocSection, book: FontBook, imageFor: ImageFor) {
    this.d = d
    this.s = s
    this.book = book
    this.imageFor = imageFor
    this.newPage()
  }
  get left() { return this.s.margins.left }
  get width() { return this.s.width - this.s.margins.left - this.s.margins.right }
  get bottom() { return this.s.height - this.s.margins.bottom }
  newPage() {
    this.page = this.d.addPage(this.s.width, this.s.height)
    this.y = this.s.margins.top
  }
  atTop() { return this.y <= this.s.margins.top + 0.5 }

  /** a paragraph in the flow, split between lines where the page ends */
  paragraph(p: Paragraph) {
    if (p.pageBreakBefore && !this.atTop()) this.newPage()
    if (!this.atTop()) this.y += p.before ?? 0
    const sp = slidePara(p)
    const right = p.indentRight ?? 0
    const [laid] = layoutText([{ ...sp, before: 0, after: 0 }], Math.max(10, this.width - right), true, 0, this.book)
    for (const ln of laid.lines) {
      if (this.y + ln.height > this.bottom && !this.atTop()) this.newPage()
      const one: Laid = { ...laid, lines: [ln], bullet: ln === laid.lines[0] ? laid.bullet : undefined, before: 0, after: 0 }
      drawText(this.page, [one], { x: this.left, y: this.y, w: Math.max(10, this.width - right), h: ln.height }, 'top')
      this.y += ln.height
    }
    this.y += p.after ?? 0
  }

  /** paragraphs in a text box at a place on the page (or below the paragraph they hang from) */
  framed(group: Paragraph[], anchorY: number) {
    const f = group[0].frame!
    const x = f.from?.h === 'margin' ? this.left + f.x : f.x
    const y = f.from?.v === 'margin' ? this.s.margins.top + f.y : f.from?.v === 'paragraph' ? anchorY + f.y : f.y
    const laid = layoutText(group.map(slidePara), Math.max(10, f.w), true, 0, this.book)
    drawText(this.page, laid, { x, y, w: f.w, h: f.h ?? 0 }, 'top')
  }

  picture(p: Picture, anchorY: number) {
    const id = this.imageFor(p)
    if (p.at) {
      const x = p.from?.h === 'margin' ? this.left + p.at.x : p.at.x
      const y = p.from?.v === 'margin' ? this.s.margins.top + p.at.y : p.from?.v === 'paragraph' ? anchorY + p.at.y : p.at.y
      if (id !== null) this.page.image(id, x, y, p.width, p.height)
      return
    }
    const k = Math.min(1, this.width / p.width)
    const [w, h] = [p.width * k, p.height * k]
    if (this.y + h > this.bottom && !this.atTop()) this.newPage()
    if (id !== null) this.page.image(id, this.left, this.y, w, h)
    else this.page.fillRect(this.left, this.y, w, h, [235, 235, 235])
    this.y += h
  }

  table(t: Table) {
    const total = t.colWidths.reduce((a, b) => a + b, 0)
    const k = total > this.width ? this.width / total : 1
    const xs = [this.left]
    for (const w of t.colWidths) xs.push(xs[xs.length - 1] + w * k)
    const line = (x0: number, y0: number, x1: number, y1: number) => this.page.line(x0, y0, x1, y1, 0.5, [0, 0, 0])
    // a cell continued from the row above is drawn as part of it: rows are drawn one at a time, so its text stays in its first row
    t.rows.forEach((row, ri) => {
      let col = 0
      const cells = row.map((c) => {
        const span = c.cols ?? 1
        const box = { x0: xs[col], x1: xs[Math.min(xs.length - 1, col + span)], c }
        col += span
        return box
      })
      const laid = cells.map((b) => (b.c.vMerge === 'continue' ? [] : layoutText(b.c.paragraphs.map(slidePara), Math.max(4, b.x1 - b.x0 - 2 * CELL_PAD), true, 0, this.book)))
      const textH = laid.map((l) => l.reduce((h, p, i) => h + (i ? p.before : 0) + p.lines.reduce((a, x) => a + x.height, 0) + p.after, 0))
      const h = Math.max(t.rowHeights?.[ri] ?? 0, ...textH, 12)
      if (this.y + h > this.bottom && !this.atTop()) this.newPage()
      cells.forEach((b, i) => {
        if (b.c.fill) this.page.fillRect(b.x0, this.y, b.x1 - b.x0, h, hexRgb(b.c.fill))
        if (laid[i].length) drawText(this.page, laid[i], { x: b.x0 + CELL_PAD, y: this.y, w: b.x1 - b.x0 - 2 * CELL_PAD, h }, 'top')
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
}

/** a Word document as PDF pages */
export function layoutDocx(d: PdfDrawing, doc: DocModel, book: FontBook, imageFor: ImageFor): void {
  for (const s of doc.sections) {
    const flow = new Flow(d, s, book, imageFor)
    let anchorY = flow.y
    for (let i = 0; i < s.blocks.length; i++) {
      const b = s.blocks[i]
      if (b.kind === 'p' && b.frame) {
        const group = [b]
        while (i + 1 < s.blocks.length && s.blocks[i + 1].kind === 'p' && (s.blocks[i + 1] as Paragraph).frame === b.frame) group.push(s.blocks[++i] as Paragraph)
        flow.framed(group, anchorY)
      } else if (b.kind === 'p') {
        anchorY = flow.y
        flow.paragraph(b)
      } else if (b.kind === 'picture') flow.picture(b, anchorY)
      else flow.table(b)
    }
  }
}
