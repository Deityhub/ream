// Text of a shape or a table cell laid out on lines the way a slide does: runs of mixed styles (capitals, letter spacing,
// superscript, highlight), wrapping inside the box, bullets and levels, alignment including justified, line heights, space
// between paragraphs, and anchoring in the box.
import { measure, type FontSpec, type PageDraw, type Seg } from '@ream/pdf-core'
import type { FontBook } from '../fonts/book.ts'
import type { SlidePara, SlideRun } from '@ream/office-core'
import { hexRgb } from '../office-fonts.ts'

/** what a line of type is as tall as, in em: the usual ascent and descent of the fonts slides use */
const EM_HEIGHT = 1.2

type Piece = { text: string; run: SlideRun; font: FontSpec; size: number; rise: number; width: number; space: boolean }
type Line = { pieces: Piece[]; width: number; size: number; height: number; start: number; avail: number; last: boolean }
type Mark = 'disc' | 'circle' | 'square' | 'box' | 'diamond' | 'arrowhead' | 'check' | 'arrow'
export type Laid = { para: SlidePara; lines: Line[]; before: number; after: number; bullet?: { text: string; mark?: Mark; font: FontSpec; size: number; x: number; color: string | undefined } }

export const fontFor = (r: SlideRun, book: FontBook): FontSpec => book.spec(r.font, r.bold, r.italic)

const SYMBOL_FONT = /wingdings|webdings|symbol|marlett/i
/** bullets of the symbol fonts by the letter they are stored as, drawn as marks */
const WINGDINGS: Record<string, Mark> = { q: 'box', o: 'box', n: 'square', '§': 'square', l: 'disc', Ÿ: 'disc', Ø: 'arrowhead', ü: 'check', v: 'diamond', u: 'diamond', w: 'diamond', à: 'arrow', è: 'arrow', ð: 'arrow' }
/** Unicode bullets the bundled fonts may not have, drawn as marks too */
const UNICODE: Record<string, Mark> = { '■': 'square', '▪': 'square', '◼': 'square', '□': 'box', '❑': 'box', '●': 'disc', '⚫': 'disc', '○': 'circle', '◦': 'circle', '◆': 'diamond', '❖': 'diamond', '♦': 'diamond', '►': 'arrowhead', '▶': 'arrowhead', '➢': 'arrowhead', '➤': 'arrowhead', '✓': 'check', '✔': 'check', '→': 'arrow', '⇒': 'arrow' }

function markOf(char: string, font: string | undefined): Mark | undefined {
  if (font && SYMBOL_FONT.test(font)) return WINGDINGS[char] ?? 'disc'
  return UNICODE[char]
}

/** a run's text as shown: capitals for 'all' and (ponytail: drawn as capitals at 80%) 'small' */
const shown = (r: SlideRun) => (r.caps ? r.text.toUpperCase() : r.text)

/** every paragraph's lines for a text area `width` wide; list numbering carries from one paragraph to the next */
export function layoutText(paras: SlidePara[], width: number, wrap: boolean, lineReduction: number, book: FontBook): Laid[] {
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
      const mark = para.bullet === 'number' ? undefined : markOf(para.bullet, para.bulletFont)
      const face = para.bulletFont && !SYMBOL_FONT.test(para.bulletFont) ? para.bulletFont : r.font
      bullet = { text: para.bullet === 'number' ? `${n}.` : para.bullet, mark, font: book.spec(face, false, false), size: (r.size ?? 18) * (para.bulletScale ?? 1), x: marL + indent, color: para.bulletColor ?? r.color }
    } else if (!para.bullet) counters.clear()
    // words and the spaces between them, in the style of the run they came from; a newline ends the line
    const tokens: (Piece | 'break')[] = []
    for (const run of para.runs) {
      const font = fontFor(run, book)
      const base = run.size ?? 18
      // raised and lowered text is drawn smaller, the way PowerPoint does
      const size = run.baseline ? base * 0.67 : run.caps === 'small' ? base * 0.8 : base
      const rise = run.baseline ? run.baseline * base : 0
      for (const t of shown(run).match(/\n|[^\S\n]+|[^\s]+/g) ?? []) {
        if (t === '\n') tokens.push('break')
        else tokens.push({ text: t, run, font, size, rise, width: measure(t, size, font) + (run.spacing ?? 0) * [...t].length, space: /^\s/.test(t) })
      }
    }
    const lines: Line[] = []
    let cur: Piece[] = []
    let w = 0
    const finish = (last: boolean) => {
      while (cur.length && cur[cur.length - 1].space) w -= cur.pop()!.width
      const size = Math.max(...cur.map((p) => (p.rise ? p.size / 0.67 : p.size)), cur.length ? 0 : para.size ?? 18)
      const first = lines.length === 0
      const avail = Math.max(1, width - (first ? start0 : marL))
      const lh = para.line ?? (para.lineFactor ?? 1) * (1 - lineReduction) * EM_HEIGHT * size
      lines.push({ pieces: cur, width: w, size, height: lh, start: first ? start0 : marL, avail, last })
      cur = []
      w = 0
    }
    for (const tk of tokens) {
      if (tk === 'break') { finish(true); continue }
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

/** a bullet mark drawn as a shape: a box `s` tall with its bottom on the baseline */
function drawMark(page: PageDraw, mark: Mark, x: number, baseline: number, s: number, color: [number, number, number]) {
  const d = s * 0.45
  const [cx, cy] = [x + d / 2 + s * 0.05, baseline - s * 0.32]
  const sq = (r: number): Seg[] => [['M', cx - r, cy - r], ['L', cx + r, cy - r], ['L', cx + r, cy + r], ['L', cx - r, cy + r], ['Z']]
  const K = 0.5523
  const circle = (r: number): Seg[] => [['M', cx + r, cy], ['C', cx + r, cy + K * r, cx + K * r, cy + r, cx, cy + r], ['C', cx - K * r, cy + r, cx - r, cy + K * r, cx - r, cy], ['C', cx - r, cy - K * r, cx - K * r, cy - r, cx, cy - r], ['C', cx + K * r, cy - r, cx + r, cy - K * r, cx + r, cy], ['Z']]
  const r = d / 2
  if (mark === 'disc') page.path(circle(r * 0.8), { fill: color })
  else if (mark === 'circle') page.path(circle(r * 0.8), { stroke: color, width: s * 0.06 })
  else if (mark === 'square') page.path(sq(r * 0.75), { fill: color })
  else if (mark === 'box') page.path(sq(r * 0.8), { stroke: color, width: s * 0.06 })
  else if (mark === 'diamond') page.path([['M', cx, cy - r], ['L', cx + r, cy], ['L', cx, cy + r], ['L', cx - r, cy], ['Z']], { fill: color })
  else if (mark === 'arrowhead') page.path([['M', cx - r, cy - r], ['L', cx + r, cy], ['L', cx - r, cy + r], ['L', cx - r * 0.4, cy], ['Z']], { fill: color })
  else if (mark === 'check') page.path([['M', cx - r, cy], ['L', cx - r * 0.25, cy + r * 0.8], ['L', cx + r, cy - r]], { stroke: color, width: s * 0.09 })
  else page.path([['M', cx - r, cy], ['L', cx + r, cy], ['M', cx + r * 0.3, cy - r * 0.6], ['L', cx + r, cy], ['L', cx + r * 0.3, cy + r * 0.6]], { stroke: color, width: s * 0.08 })
}

/** draw laid out text in the area; `anchor` places the block in it. Overflow is drawn, as slides do. */
export function drawText(page: PageDraw, laid: Laid[], area: { x: number; y: number; w: number; h: number }, anchor: 'top' | 'middle' | 'bottom'): void {
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
      // justified lines (not the last of a paragraph) spread the leftover room over their spaces
      const spaces = ln.pieces.filter((p) => p.space).length
      const extra = align === 'justify' && !ln.last && spaces ? Math.max(0, ln.avail - ln.width) / spaces : 0
      if (li === 0 && l.bullet) {
        // the bullet keeps its distance from the text, wherever alignment puts the text
        const b = l.bullet
        const bx = x - (ln.start - b.x)
        if (b.mark) drawMark(page, b.mark, bx, baseline, b.size, hexRgb(b.color))
        else page.text(bx, baseline, b.text, b.font, b.size, hexRgb(b.color))
      }
      // pieces of one run go out as one string, spaces included, so the text can be searched and copied from the PDF
      for (let i = 0; i < ln.pieces.length; ) {
        let j = i
        let text = ''
        let width = 0
        while (j < ln.pieces.length && ln.pieces[j].run === ln.pieces[i].run && !(extra && ln.pieces[j].space && j > i)) {
          text += ln.pieces[j].text
          width += ln.pieces[j].width + (extra && ln.pieces[j].space ? extra : 0)
          j++
        }
        const p = ln.pieces[i]
        const color = hexRgb(p.run.color)
        if (p.run.highlight) page.fillRect(x, baseline - s * 0.9, width, s * 1.15, hexRgb(p.run.highlight))
        page.text(x, baseline - p.rise, text, p.font, p.size, color, p.run.alpha, p.run.spacing)
        if (p.run.underline) page.line(x, baseline + 0.12 * p.size, x + width, baseline + 0.12 * p.size, Math.max(0.4, p.size / 18), color)
        x += width
        i = j
      }
      y += ln.height
    })
    y += l.after
  })
}
