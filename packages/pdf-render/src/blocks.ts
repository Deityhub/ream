// A page as blocks a word processor or slide tool can take: paragraphs (with runs, alignment, indents, spacing), tables and
// pictures, in reading order. Built from the same characters, lines and columns as text extraction. Heuristics: simple
// pages come out well, complex layouts are flattened into a column of blocks.
import type { PdfStream } from '@ream/pdf-core'
import type { FontKind } from './font.ts'
import type { PageChars, TextChar } from './textchars.ts'
import { BULLET, WORD_GAP, bodySizeOf, cleanText, median, paragraphs, readingColumns, readingFrame, toLines, type Para, type Placed } from './textlayout.ts'
import type { Table } from './tables.ts'

export type BlockRun = { text: string; bold: boolean; italic: boolean; size: number; face: string; kind: FontKind; color: [number, number, number] }

export type TextBlock = {
  kind: 'text'
  /** the paragraph's box in the page frame, points, y down */
  x0: number
  y0: number
  x1: number
  y1: number
  runs: BlockRun[]
  align: 'left' | 'center' | 'right' | 'justify'
  heading?: 1 | 2 | 3
  bullet: boolean
  /** the usual type size */
  size: number
  /** distance between lines, points */
  leading: number
  lines: number
  /** from the left edge of the page's text; the first line starts `indentFirst` further (negative: hangs) */
  indentLeft: number
  indentFirst: number
  /** space before the next block, points */
  after: number
  /** its lines are kept as they are on the page, joined with line breaks (placed blocks only) */
  breaks?: boolean
  /** a bullet drawn as a letter: which, in what colour, size and font (placed blocks only) */
  mark?: { text: string; color: [number, number, number]; size: number; face: string }
}

export type TableBlock = { kind: 'table'; table: Table; y0: number; y1: number; after: number }

export type PictureBlock = { kind: 'picture'; image: PdfStream; x0: number; y0: number; x1: number; y1: number; /** covers most of the page: it is a background or a scan */ background: boolean; after: number }

export type Block = TextBlock | TableBlock | PictureBlock

export type PageBlocks = {
  width: number
  height: number
  /** where the content sits, points from each edge */
  margins: { top: number; right: number; bottom: number; left: number }
  blocks: Block[]
}

const BLACK: [number, number, number] = [0, 0, 0]
const same = (a: BlockRun, b: BlockRun) => a.bold === b.bold && a.italic === b.italic && a.size === b.size && a.face === b.face && a.kind === b.kind && a.color.every((v, i) => v === b.color[i])

const runOf = (c: Placed, text: string): BlockRun => {
  const src = c.src as TextChar
  return { text, bold: c.bold, italic: c.italic, size: Math.round(c.size * 2) / 2, face: src.face ?? '', kind: src.kind ?? 'sans', color: src.color ?? BLACK }
}

/**
 * The runs of a paragraph: its lines joined (a hyphen at a line end before a lower-case letter is a split word) and equal
 * neighbours merged. With `breaks` the lines stay lines: they are joined with a line break ("\n") and nothing is rejoined.
 */
function paraRuns(p: Para, breaks = false): BlockRun[] {
  const out: BlockRun[] = []
  const push = (r: BlockRun) => {
    const last = out[out.length - 1]
    if (last && same(last, r)) last.text += r.text
    else out.push({ ...r })
  }
  p.lines.forEach((line, li) => {
    let prev: Placed | null = null
    let first = true
    for (const c of line.chars) {
      const t = cleanText(c.text)
      if (!t) continue
      if (first && li > 0) {
        const last = out[out.length - 1]
        if (breaks) {
          // the break goes after the line's last letter: spaces at the end of the line (in any font) are dropped
          while (out.length && !out[out.length - 1].text.trim()) out.pop()
          if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '') + '\n'
        }
        else if (last && /[A-Za-zÀ-ɏ]-$/.test(last.text) && /^[a-zß-ÿ]/.test(t)) last.text = last.text.slice(0, -1)
        else if (last && !/\s$/.test(last.text)) last.text += ' '
      } else if (prev && c.x0 - prev.x1 > WORD_GAP * Math.max(prev.size, c.size) && !/^\s/.test(t)) {
        const last = out[out.length - 1]
        if (last && !/\s$/.test(last.text)) last.text += ' '
      }
      push(runOf(c, t))
      first = false
      prev = c
    }
  })
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, '')
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '')
  }
  return out.filter((r) => r.text)
}

/** a paragraph as a block: its runs (a leading bullet sign taken off), its box, type size and line spacing; left aligned, no indents */
export function blockOf(p: Para, fallbackSize: number, breaks = false): TextBlock {
  const runs = paraRuns(p, breaks)
  if (runs.length && BULLET.test(runs[0].text)) runs[0].text = runs[0].text.replace(BULLET, '')
  const lines = p.lines
  const gaps = lines.slice(1).map((l, i) => l.y - lines[i].y)
  return {
    kind: 'text',
    x0: Math.min(...lines.map((l) => l.x0)),
    x1: Math.max(...lines.map((l) => l.x1)),
    y0: lines[0].y - lines[0].size,
    y1: lines[lines.length - 1].y + 0.25 * lines[lines.length - 1].size,
    runs: runs.filter((r) => r.text),
    align: 'left',
    bullet: false,
    size: median(lines.map((l) => l.size)) || fallbackSize,
    leading: gaps.length ? median(gaps) : 0,
    lines: lines.length,
    indentLeft: 0,
    indentFirst: 0,
    after: 0,
    breaks: breaks || undefined,
  }
}

const BIG_PICTURE = 0.6 // share of the page a picture covers to count as a background or a scan

/**
 * The page as blocks. `tables` are those `findTables` found: their text leaves the flow and they take their place in it.
 * Invisible text (a scan's text layer) is left out unless `invisible` asks for it. Margins come from where the content sits, not from any setting in the file.
 */
/** the x of a bullet mark (a small shape) just left of a line's first letter and level with its middle, if there is one */
export function markerBefore(line: { x0: number; y: number; size: number }, dots: { x0: number; y0: number; x1: number; y1: number }[]): number | undefined {
  const mid = line.y - 0.35 * line.size
  const hit = dots.find((d) => d.x1 <= line.x0 + 1 && d.x1 >= line.x0 - 2.5 * line.size && Math.abs((d.y0 + d.y1) / 2 - mid) < 0.4 * line.size)
  return hit?.x0
}

export function pageBlocks(page: PageChars, tables: Table[], o: { invisible?: boolean } = {}): PageBlocks {
  const { flat, turn } = readingFrame(o.invisible ? page.chars : page.chars.filter((c) => !c.invisible))
  const inTable = (c: Placed) => tables.some((t) => (c.x0 + c.x1) / 2 >= t.x0 - 1 && (c.x0 + c.x1) / 2 <= t.x1 + 1 && c.y - 0.3 * c.size >= t.y0 - 1 && c.y - 0.3 * c.size <= t.y1 + 1)
  const free = flat.filter((c) => !inTable(c))
  const body = bodySizeOf(flat)
  const size = median(flat.map((c) => c.size)) || body || 10
  // with tables on the page everything is one column: the order is then simply top to bottom
  const columns = tables.length ? [free] : readingColumns(free, size)
  const bounds = { x0: Math.min(...free.map((c) => c.x0), ...tables.map((t) => t.x0)), x1: Math.max(...free.map((c) => c.x1), ...tables.map((t) => t.x1)) }
  const paras: { block: TextBlock; first: number; last: number }[] = []
  const objects: { y0: number; y1: number; x0: number; x1: number }[] = [...tables, ...page.pictures.filter((p) => p.y1 - p.y0 >= 4)]
  const pageLead: number[] = []

  for (const col of columns) {
    if (!col.length) continue
    const cx0 = Math.min(...col.map((c) => c.x0))
    const cx1 = Math.max(...col.map((c) => c.x1))
    // a table or a picture between two lines ends the paragraph: lines above and below it never belong together
    const all = toLines(col)
    if (!turn) for (const line of all) line.marker = markerBefore(line, page.shapes.dots)
    const groups: (typeof all)[] = []
    for (const line of all) {
      const g = groups[groups.length - 1]
      const prev = g?.[g.length - 1]
      // something between the two lines and under them (not beside them) ends the paragraph
      const between = (o: (typeof objects)[number]) => prev!.y <= o.y1 && line.y >= o.y0 && o.x0 < Math.max(prev!.x1, line.x1) && o.x1 > Math.min(prev!.x0, line.x0)
      if (g && prev && !objects.some(between)) g.push(line)
      else groups.push([line])
    }
    const ps = groups.flatMap((g) => paragraphs(g))
    for (const p of ps) {
      const gaps = p.lines.slice(1).map((l, i) => l.y - p.lines[i].y)
      if (gaps.length) pageLead.push(median(gaps))
    }
    for (const p of ps) {
      const base = blockOf(p, size)
      if (!base.runs.length) continue
      const lines = p.lines
      const psize = base.size
      const text = paraRuns(p).map((r) => r.text).join('')
      const x0s = lines.map((l) => l.x0)
      const minX0 = base.x0
      const maxX1 = base.x1
      let align: TextBlock['align'] = 'left'
      const centred = lines.every((l) => Math.abs((l.x0 + l.x1) / 2 - (cx0 + cx1) / 2) < 4)
      if (lines.length === 1 ? centred && minX0 - cx0 > 8 && cx1 - maxX1 > 8 : centred && x0s.some((x) => Math.abs(x - minX0) > 6)) align = 'center'
      else if (lines.every((l) => Math.abs(l.x1 - cx1) < 3) && minX0 - cx0 > 8) align = 'right'
      else if (lines.length >= 3 && lines.slice(0, -1).every((l) => Math.abs(l.x1 - maxX1) < 3) && lines.slice(1).every((l) => Math.abs(l.x0 - lines[1].x0) < 3)) align = 'justify'
      const marker = lines[0].marker
      const bullet = marker !== undefined || BULLET.test(text)
      const rest = lines.slice(1)
      let indentLeft = align === 'left' || align === 'justify' ? Math.max(0, (rest.length ? Math.min(...rest.map((l) => l.x0)) : lines[0].x0) - cx0) : 0
      let indentFirst = align === 'left' || align === 'justify' ? (rest.length ? lines[0].x0 - Math.min(...rest.map((l) => l.x0)) : 0) : 0
      if (Math.abs(indentFirst) < 3) indentFirst = 0
      if (indentLeft < 3) indentLeft = 0
      if (marker !== undefined) {
        // the text starts where the first line's letters do; the mark hangs out to the left of it
        indentLeft = Math.max(0, lines[0].x0 - cx0)
        indentFirst = -Math.max(4, lines[0].x0 - marker)
      } else if (bullet) {
        const hang = Math.min(18, Math.max(8, psize))
        indentLeft = Math.max(0, lines[0].x0 - cx0) + hang
        indentFirst = -hang
      }
      let heading: TextBlock['heading']
      if (body && lines.length <= 2 && text.length <= 140 && psize >= 1.15 * body && !bullet) heading = psize >= 1.8 * body ? 1 : psize >= 1.4 * body ? 2 : 3
      const block: TextBlock = { ...base, align, heading, bullet, indentLeft, indentFirst }
      paras.push({ block, first: lines[0].y, last: lines[lines.length - 1].y })
    }
  }
  const lead = median(pageLead)
  for (const { block } of paras) if (!block.leading) block.leading = lead || block.size * 1.2

  type Item = { block: Block; top: number; firstBase: number; lastBase: number }
  const text: Item[] = paras.map((p) => ({ block: p.block, top: p.block.y0, firstBase: p.first, lastBase: p.last }))
  const others: Item[] = tables.map((t) => ({ block: { kind: 'table', table: t, y0: t.y0, y1: t.y1, after: 0 }, top: t.y0, firstBase: t.y0, lastBase: t.y1 }))
  const backgrounds: Item[] = []
  for (const pic of page.pictures) {
    const w = pic.x1 - pic.x0
    const h = pic.y1 - pic.y0
    if (w < 4 || h < 4) continue
    const background = (w * h) / (page.width * page.height) >= BIG_PICTURE
    const item: Item = { block: { kind: 'picture', image: pic.image, x0: pic.x0, y0: pic.y0, x1: pic.x1, y1: pic.y1, background, after: 0 }, top: pic.y0, firstBase: pic.y0, lastBase: pic.y1 }
    ;(background ? backgrounds : others).push(item)
  }
  // text keeps the order its columns give; tables and pictures go in before the first text that starts below their top
  const flow = [...text]
  for (const o of others.sort((a, b) => a.top - b.top)) {
    const at = flow.findIndex((t) => t.top > o.top)
    flow.splice(at < 0 ? flow.length : at, 0, o)
  }
  const ordered = [...backgrounds, ...flow]
  // space after each block: what lies between the end of one block and the start of the next, less one line of the next
  flow.forEach((it, i) => {
    const next = flow[i + 1]
    if (!next) return
    it.block.after = Math.min(150, Math.max(0, next.firstBase - it.lastBase - (next.block.kind === 'text' ? next.block.leading : 0)))
  })

  const margins = {
    top: Math.max(0, Math.min(...flow.map((i) => i.top), page.height)),
    left: Math.max(0, Math.min(bounds.x0, page.width)),
    right: Math.max(0, page.width - Math.max(bounds.x1, 0)),
    bottom: Math.max(0, page.height - Math.max(...flow.map((i) => i.block.y1), 0)),
  }
  if (!flow.length) Object.assign(margins, { top: 36, left: 36, right: 36, bottom: 36 })
  return { width: page.width, height: page.height, margins, blocks: ordered.map((i) => i.block) }
}
