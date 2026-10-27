// A page's text as boxes in the places it sits, for conversions that keep the page's look (PDF to PowerPoint, Word's
// "same layout"): no reading order, columns or tables. Lines are cut at wide gaps into pieces, and pieces are stacked into
// a box only where they really are one paragraph: a line apart, the same type size, and lined up on a left edge, a centre
// or a right edge. Text in columns, beside a title or in table cells therefore can't run together.
import type { PageChars } from './textchars.ts'
import { WORD_GAP, cleanText, median, readingFrame, toLines, type Line, type Placed } from './textlayout.ts'
import { blockOf, markerBefore, type TextBlock } from './blocks.ts'

/** a gap wider than this many font sizes ends a piece (word gaps are about a quarter, justified ones under one) */
const PIECE_GAP = 1.5
/** points: centres and right edges closer than this line up; left-aligned lines start at the same x, so that test is tighter */
const EDGE = 4
const LEFT = 0.75
const BULLET_ONLY = /^[•◦▪▫‣●○■□▸►·–—-]$/
/** a numbered list item: "1." "2)" "a." at the start of a line */
const NUMBERED = /^(?:\d{1,3}|[a-z])[.)]/

type Piece = Line & { bullet: boolean; numbered?: boolean; marker?: number; /** where the text starts, after a bullet */ textX0: number; mark?: Placed }

function piecesOf(line: Line): Piece[] {
  const out: Piece[] = []
  let cur: Placed[] = []
  const flush = () => {
    const cs = cur.filter((c) => cleanText(c.text).trim())
    if (cs.length) out.push({ chars: cur, y: line.y, size: median(cs.map((c) => c.size)) || line.size, x0: cs[0].x0, x1: Math.max(...cs.map((c) => c.x1)), text: '', bullet: false, textX0: cs[0].x0 })
    cur = []
  }
  let prev: Placed | undefined
  for (const c of line.chars) {
    if (!cleanText(c.text).trim()) { cur.push(c); continue }
    if (prev && c.x0 - prev.x1 > PIECE_GAP * Math.max(c.size, prev.size)) flush()
    cur.push(c)
    prev = c
  }
  flush()
  // a lone bullet sign belongs to the text after it
  for (let i = 0; i < out.length - 1; i++) {
    const p = out[i]
    const t = p.chars.map((c) => cleanText(c.text)).join('').trim()
    if (BULLET_ONLY.test(t) && out[i + 1].x0 - p.x1 < 4 * p.size) {
      const next = out.splice(i + 1, 1)[0]
      out[i] = { ...next, chars: [...p.chars, ...next.chars], x0: p.x0, bullet: true, textX0: next.x0, mark: p.chars.find((c) => cleanText(c.text).trim()) }
    }
  }
  for (const p of out) {
    if (p.bullet) continue
    // a bullet sign as the first letter, set apart from the text by a space or a gap (slides often leave no space)
    const visible = p.chars.filter((c) => cleanText(c.text).trim())
    const [m, next] = visible
    const apart = next && (next.x0 - m.x1 > WORD_GAP * m.size || p.chars.indexOf(next) > p.chars.indexOf(m) + 1)
    if (m && next && BULLET_ONLY.test(cleanText(m.text).trim()) && apart) {
      p.bullet = true
      p.mark = m
      p.textX0 = next.x0
    } else if (NUMBERED.test(visible.map((c) => cleanText(c.text)).join('').slice(0, 6))) p.numbered = true
  }
  return out
}

type Group = { pieces: Piece[]; align?: 'left' | 'center' | 'right' }

/** the page's text as boxes where it is */
export function placedBlocks(page: PageChars): TextBlock[] {
  const { flat, turn } = readingFrame(page.chars.filter((c) => !c.invisible))
  const pieces = toLines(flat).flatMap(piecesOf).sort((a, b) => a.y - b.y || a.x0 - b.x0)
  if (!turn) for (const p of pieces) {
    p.marker = markerBefore(p, page.shapes.dots)
    if (p.marker !== undefined) p.bullet = true
  }
  const groups: Group[] = []
  for (const p of pieces) {
    let best: { g: Group; align: 'left' | 'center' | 'right' } | undefined
    for (const g of groups) {
      const last = g.pieces[g.pieces.length - 1]
      const step = p.y - last.y
      if (p.bullet || p.numbered || step < 0.6 * p.size || step > 1.8 * Math.max(p.size, last.size)) continue
      if (Math.abs(p.size - last.size) > 0.12 * last.size) continue
      // lines of a paragraph keep one spacing
      if (g.pieces.length > 1 && Math.abs(step - (last.y - g.pieces[g.pieces.length - 2].y)) > 0.25 * p.size) continue
      if (p.x1 < last.x0 || p.x0 > last.x1) continue
      // a ruled line between them (a table's rows) keeps them apart
      if (!turn && page.shapes.rules.some((r) => r.y0 === r.y1 && r.y0 > last.y + 0.1 * last.size && r.y0 < p.y - 0.7 * p.size && r.x0 < Math.max(p.x1, last.x1) && r.x1 > Math.min(p.x0, last.x0))) continue
      const first = g.pieces[0]
      const left = Math.abs(p.x0 - first.textX0) <= LEFT
      const centre = Math.abs((p.x0 + p.x1) / 2 - (last.x0 + last.x1) / 2) <= EDGE
      const right = Math.abs(p.x1 - last.x1) <= EDGE
      const align = g.align === 'center' ? (centre ? 'center' : undefined) : g.align === 'right' ? (right ? 'right' : undefined) : g.align === 'left' ? (left ? 'left' : undefined) : left ? 'left' : centre ? 'center' : right ? 'right' : undefined
      if (align && (!best || last.y > best.g.pieces[best.g.pieces.length - 1].y)) best = { g, align }
    }
    if (best) { best.g.pieces.push(p); best.g.align = best.align }
    else groups.push({ pieces: [p] })
  }
  // a single line takes the alignment of a block it is centred or right-aligned with (a name under a centred title)
  const edges = (g: Group) => ({ x0: Math.min(...g.pieces.map((p) => p.x0)), x1: Math.max(...g.pieces.map((p) => p.x1)) })
  for (const g of groups) {
    if (g.align || g.pieces.length > 1) continue
    const a = edges(g)
    for (const o of groups) {
      if (o === g) continue
      const b = edges(o)
      if (Math.abs(a.x0 - b.x0) <= LEFT) break
      if (Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2) <= EDGE && (o.align === 'center' || o.pieces.length === 1)) { g.align = 'center'; break }
      if (Math.abs(a.x1 - b.x1) <= EDGE && (o.align === 'right' || o.pieces.length === 1)) { g.align = 'right'; break }
    }
  }
  return groups.map((g) => {
    const first = g.pieces[0]
    const block = blockOf({ lines: g.pieces }, first.size, true)
    block.align = g.align ?? 'left'
    block.bullet = first.bullet
    if (first.marker !== undefined) {
      // a bullet drawn as a shape stays in the page's design: the box holds the text only
      block.bullet = false
      block.indentLeft = 0
      block.indentFirst = 0
    } else if (first.bullet && first.mark) {
      // a bullet drawn as a letter hangs out to the left of the text
      const m = first.mark
      block.indentLeft = first.textX0 - first.x0
      block.indentFirst = -block.indentLeft
      block.mark = { text: cleanText(m.text).trim(), color: m.src.color ?? [0, 0, 0], size: m.size, face: m.src.face ?? '' }
    } else {
      block.indentLeft = 0
      block.indentFirst = 0
    }
    block.heading = undefined
    return block
  }).filter((b) => b.runs.length)
}
