// Finding where a flat form wants its fields: runs of underscores or dots, lines to write on, empty boxes and small
// squares to tick, each named after the label beside it. Heuristics on the page's letters and ruled lines (no OCR, so
// a scanned page has nothing to find); what they suggest is added as ordinary fields to check and delete.
import type { Rect } from '../rect.ts'
import type { FieldType } from './items.ts'

/** a page's letters and ruled lines in points as displayed (y down): a letter's box from above its baseline to below it */
export type PageLayout = {
  width: number
  height: number
  chars: { text: string; x0: number; y0: number; x1: number; y1: number; size: number }[]
  rules: { x0: number; y0: number; x1: number; y1: number }[]
}

export type Suggestion = { type: FieldType; box: Rect; label: string }

type Box = { x0: number; y0: number; x1: number; y1: number }
type Char = PageLayout['chars'][number]

const NEAR = 2.5 // points of slack for lines meeting at a corner
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
const area = (a: Box) => (a.x1 - a.x0) * (a.y1 - a.y0)
const inside = (c: Char, b: Box) => (c.x0 + c.x1) / 2 > b.x0 && (c.x0 + c.x1) / 2 < b.x1 && (c.y0 + c.y1) / 2 > b.y0 && (c.y0 + c.y1) / 2 < b.y1

/** letters on one line, by their middles, left to right */
function lines(chars: Char[]): Char[][] {
  const out: Char[][] = []
  for (const c of [...chars].sort((a, b) => a.y1 - b.y1 || a.x0 - b.x0)) {
    const l = out.find((x) => Math.abs(x[0].y1 - c.y1) < c.size * 0.4)
    if (l) l.push(c)
    else out.push([c])
  }
  for (const l of out) l.sort((a, b) => a.x0 - b.x0)
  return out
}

/** the words that end just before `x` on the line `chars` (a gap of more than two letters ends them) */
function wordsBefore(line: Char[], x: number): string {
  const left = line.filter((c) => c.x1 <= x + 1)
  let text = ''
  for (let i = left.length - 1; i >= 0; i--) {
    const c = left[i]
    const next = left[i + 1]
    const gap = (next ? next.x0 : x) - c.x1
    if (gap > c.size * (text ? 1.2 : 12)) break
    text = c.text + (gap > c.size * 0.2 && text ? ' ' : '') + text
  }
  return text
}

/** a field's name from its label: no colons, underscores, dots or runs of spaces */
const clean = (s: string) => s.replace(/[_.…:]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)

/** the words that start just after `x` */
function wordsAfter(line: Char[], x: number): string {
  let text = ''
  let last: Char | null = null
  for (const c of line.filter((c) => c.x0 >= x - 1)) {
    const gap = c.x0 - (last ? last.x1 : x)
    if (gap > c.size * (last ? 1.2 : 3)) break
    text += (last && gap > c.size * 0.2 ? ' ' : '') + c.text
    last = c
  }
  return text
}

function labelFor(b: Box, rows: Char[][], tick: boolean): string {
  // the line of text level with the box: most of its letters' height within the box's
  const same = rows.find((l) => l.some((c) => Math.min(c.y1, b.y1) - Math.max(c.y0, b.y0) > 0.4 * (c.y1 - c.y0)))
  // a box to tick has its label after it, mostly; anything else before it
  const order = tick ? [wordsAfter, wordsBefore] : [wordsBefore]
  for (const words of order) {
    const got = same ? clean(words(same, words === wordsAfter ? b.x1 : b.x0)) : ''
    if (got) return got
  }
  // the line just above, over the field's left part
  const above = rows.filter((l) => l[0].y1 <= b.y0 + 1 && b.y0 - l[0].y1 < l[0].size * 2).sort((p, q) => q[0].y1 - p[0].y1)[0]
  if (!above) return ''
  return clean(above.filter((c) => c.x1 > b.x0 - 4 && c.x0 < b.x1).map((c) => c.text).join(''))
}

/** suggested fields for one page; nothing where a field already is (`taken`, fractions of the page) */
export function detectFields(page: PageLayout, taken: Rect[] = []): Suggestion[] {
  const { width: W, height: H } = page
  const chars = page.chars.filter((c) => c.text.trim() || c.text === ' ')
  const rows = lines(chars.filter((c) => c.text.trim()))
  const found: { type: FieldType; box: Box }[] = []

  // runs of underscores (four or more) or of dots (six or more) on a line: write on them
  for (const l of lines(chars)) {
    let run: Char[] = []
    const flush = () => {
      const under = run.every((c) => c.text === '_')
      if (run.length >= (under ? 4 : 6)) {
        const size = run[0].size
        const base = run[0].y1 - size * 0.2
        found.push({ type: 'text', box: { x0: run[0].x0, y0: base - size * 1.1, x1: run[run.length - 1].x1, y1: base + size * 0.15 } })
      }
      run = []
    }
    for (const c of l) {
      const kind = c.text === '_' ? '_' : c.text === '.' || c.text === '…' ? '.' : null
      const last = run[run.length - 1]
      if (kind && (!last || ((last.text === '_') === (kind === '_') && c.x0 - last.x1 < c.size * 0.5))) run.push(c)
      else {
        flush()
        if (kind) run.push(c)
      }
    }
    flush()
  }

  // box characters (☐ □) are checkboxes
  for (const c of chars) if (c.text === '☐' || c.text === '□' || c.text === '❑') found.push({ type: 'checkbox', box: { x0: c.x0, y0: c.y1 - (c.x1 - c.x0) - c.size * 0.2, x1: c.x1, y1: c.y1 - c.size * 0.2 } })

  // boxes made of four ruled lines
  const flat = page.rules.filter((r) => r.y1 - r.y0 < NEAR && r.x1 - r.x0 > 4)
  const upright = page.rules.filter((r) => r.x1 - r.x0 < NEAR && r.y1 - r.y0 > 4)
  const used = new Set<(typeof flat)[number]>()
  for (const top of flat) {
    for (const bottom of flat) {
      if (bottom === top || bottom.y0 <= top.y0 + 4 || Math.abs(bottom.x0 - top.x0) > NEAR || Math.abs(bottom.x1 - top.x1) > NEAR) continue
      const side = (x: number) => upright.some((v) => Math.abs(v.x0 - x) < NEAR && v.y0 <= top.y0 + NEAR && v.y1 >= bottom.y0 - NEAR)
      if (!side(top.x0) || !side(top.x1)) continue
      // the nearest bottom only: a box, not the stack of boxes under it
      if (flat.some((m) => m !== top && m !== bottom && m.y0 > top.y0 + 2 && m.y0 < bottom.y0 - 2 && m.x0 <= top.x0 + NEAR && m.x1 >= top.x1 - NEAR)) continue
      const box = { x0: top.x0, y0: top.y0, x1: top.x1, y1: bottom.y0 }
      const [w, h] = [box.x1 - box.x0, box.y1 - box.y0]
      if (chars.some((c) => c.text.trim() && inside(c, box))) continue
      if (w >= 6 && w <= 20 && Math.abs(w - h) < 3) found.push({ type: 'checkbox', box })
      else if (h >= 10 && w >= 2 * h && h < H / 3) found.push({ type: 'text', box: { x0: box.x0 + 1, y0: box.y0 + 1, x1: box.x1 - 1, y1: box.y1 - 1 } })
      else continue
      used.add(top)
      used.add(bottom)
    }
  }

  // a line at least 40 points long with nothing written on it: the space above it
  for (const r of flat) {
    if (used.has(r) || r.x1 - r.x0 < 40 || r.x1 - r.x0 > W * 0.95) continue
    // a rule across a table row is not a line to write on
    if (upright.some((v) => (Math.abs(v.x0 - r.x0) < NEAR || Math.abs(v.x0 - r.x1) < NEAR) && v.y0 < r.y0 + NEAR && v.y1 > r.y0 - NEAR)) continue
    const over = chars.filter((c) => c.text.trim() && c.x1 > r.x0 && c.x0 < r.x1)
    // written on: a baseline just above the line
    if (over.some((c) => { const base = c.y1 - c.size * 0.2; return base > r.y0 - 6 && base < r.y0 + 2 })) continue
    // as tall as the room above it allows, up to 18 points
    const room = Math.min(18, ...over.filter((c) => c.y1 <= r.y0).map((c) => r.y0 - c.y1 - 1))
    if (room < 8) continue
    found.push({ type: 'text', box: { x0: r.x0, y0: r.y0 - room, x1: r.x1, y1: r.y0 } })
  }

  // one suggestion per place, none over another or over a field there already
  const kept: { type: FieldType; box: Box }[] = []
  const takenPts = taken.map((t) => ({ x0: t.x * W, y0: t.y * H, x1: (t.x + t.w) * W, y1: (t.y + t.h) * H }))
  for (const f of found) {
    const clash = (o: Box) => overlap(f.box, o) > 0.3 * Math.min(area(f.box), area(o))
    if (kept.some((k) => clash(k.box)) || takenPts.some(clash)) continue
    kept.push(f)
  }
  return kept
    .sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0)
    .map((f) => ({
      type: f.type,
      label: labelFor(f.box, rows, f.type === 'checkbox'),
      box: { x: Math.max(0, f.box.x0 / W), y: Math.max(0, f.box.y0 / H), w: Math.min(1, (f.box.x1 - f.box.x0) / W), h: Math.min(1, (f.box.y1 - f.box.y0) / H) },
    }))
}
