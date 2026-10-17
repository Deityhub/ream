// Text of a shape or a table cell laid out on lines the way a slide does: runs of mixed styles, wrapping inside the box,
// bullets and levels, alignment, line heights, space between paragraphs, and anchoring in the box.
import { measure, type FontSpec, type PageDraw, type PreparedFont } from '@ream/pdf-core'
import type { SlidePara, SlideRun } from '@ream/office-core'
import { familyOf, hexRgb, widthScale } from '../office-fonts.ts'

/** what a line of type is as tall as, in em: the usual ascent and descent of the fonts slides use */
const EM_HEIGHT = 1.2
const ASCENT = 0.93

type Piece = { text: string; run: SlideRun; font: FontSpec; size: number; width: number; space: boolean }
type Line = { pieces: Piece[]; width: number; size: number; height: number; start: number; avail: number; last: boolean }
export type Laid = { para: SlidePara; lines: Line[]; before: number; after: number; bullet?: { text: string; font: FontSpec; size: number; x: number; color: string | undefined } }

export const fontFor = (r: SlideRun, emb: PreparedFont | null): FontSpec => ({ family: emb ? 'custom' : familyOf(r.font), bold: r.bold, italic: r.italic, scale: emb ? 1 : widthScale(r.font) })

/** every paragraph's lines for a text area `width` wide. `numbers` carries list numbering from one paragraph to the next. */
export function layoutText(paras: SlidePara[], width: number, wrap: boolean, lineReduction: number, emb: PreparedFont | null): Laid[] {
  const out: Laid[] = []
  const counters = new Map<number, number>()
  for (const para of paras) {
    const marL = para.marginLeft ?? 0
    const indent = para.indent ?? 0
    const start0 = para.bullet ? marL : marL + indent
    let bullet: Laid['bullet']
    if (para.bullet && para.runs.length) {
      const level = Math.round(marL)
      const n = para.bullet === 'number' ? (counters.get(level) ?? 0) + 1 : 0
      counters.set(level, n)
      for (const k of counters.keys()) if (k > level) counters.delete(k)
      const r = para.runs[0]
      bullet = { text: para.bullet === 'number' ? `${n}.` : para.bullet, font: fontFor({ ...r, bold: false, italic: false, text: '' }, emb), size: r.size ?? 18, x: marL + indent, color: r.color }
    } else if (!para.bullet) counters.clear()
    // words and the spaces between them, in the style of the run they came from; a newline ends the line
    const tokens: (Piece | 'break')[] = []
    for (const run of para.runs) {
      const font = fontFor(run, emb)
      const size = run.size ?? 18
      for (const t of run.text.match(/\n|[^\S\n]+|[^\s]+/g) ?? []) {
        if (t === '\n') tokens.push('break')
        else tokens.push({ text: t, run, font, size, width: measure(t, size, font, emb), space: /^\s/.test(t) })
      }
    }
    const lines: Line[] = []
    let cur: Piece[] = []
    let w = 0
    const finish = (last: boolean) => {
      while (cur.length && cur[cur.length - 1].space) w -= cur.pop()!.width
      const size = Math.max(...cur.map((p) => p.size), para.size ?? 18)
      const first = lines.length === 0
      const avail = Math.max(1, width - (first ? start0 : marL))
      const lh = para.line ?? (para.lineFactor ?? 1) * (1 - lineReduction) * EM_HEIGHT * size
      lines.push({ pieces: cur, width: w, size, height: lh, start: first ? start0 : marL, avail, last })
      cur = []
      w = 0
    }
    for (const tk of tokens) {
      if (tk === 'break') { finish(false); continue }
      const first = lines.length === 0
      const avail = width - (first ? start0 : marL)
      if (wrap && !tk.space && cur.some((p) => !p.space) && w + tk.width > avail) finish(false)
      if (!(tk.space && !cur.length)) { cur.push(tk); w += tk.width }
    }
    finish(true)
    out.push({ para, lines, before: para.before ?? 0, after: para.after ?? 0, bullet })
  }
  return out
}

export const textHeight = (laid: Laid[]): number => laid.reduce((h, l, i) => h + (i ? l.before : 0) + l.lines.reduce((a, ln) => a + ln.height, 0) + l.after, 0)

/** draw laid out text in the area; `anchor` places the block in it. Returns nothing: overflow is drawn, as slides do. */
export function drawText(page: PageDraw, laid: Laid[], area: { x: number; y: number; w: number; h: number }, anchor: 'top' | 'middle' | 'bottom', emb: PreparedFont | null): void {
  const total = textHeight(laid)
  let y = anchor === 'middle' ? area.y + (area.h - total) / 2 : anchor === 'bottom' ? area.y + area.h - total : area.y
  laid.forEach((l, pi) => {
    if (pi) y += l.before
    l.lines.forEach((ln, li) => {
      const s = ln.size
      const baseline = y + ln.height - 0.27 * s - Math.max(0, (ln.height - EM_HEIGHT * s) / 2)
      const align = l.para.align ?? 'left'
      let x = area.x + ln.start
      if (align === 'center') x = area.x + ln.start + (ln.avail - ln.width) / 2
      else if (align === 'right') x = area.x + ln.start + ln.avail - ln.width
      if (li === 0 && l.bullet) page.text(area.x + l.bullet.x, baseline, l.bullet.text, l.bullet.font, l.bullet.size, hexRgb(l.bullet.color))
      // pieces of one run go out as one string, spaces included, so the text can be searched and copied from the PDF
      for (let i = 0; i < ln.pieces.length; ) {
        let j = i
        let text = ''
        let width = 0
        while (j < ln.pieces.length && ln.pieces[j].run === ln.pieces[i].run) {
          text += ln.pieces[j].text
          width += ln.pieces[j].width
          j++
        }
        const p = ln.pieces[i]
        page.text(x, baseline, text, p.font, p.size, hexRgb(p.run.color))
        if (p.run.underline) page.line(x, baseline + 0.12 * p.size, x + width, baseline + 0.12 * p.size, Math.max(0.4, p.size / 18), hexRgb(p.run.color))
        x += width
        i = j
      }
      y += ln.height
    })
    y += l.after
  })
}
