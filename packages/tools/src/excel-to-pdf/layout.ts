// A spreadsheet laid out on pages: columns and rows from the file's sizes, cell fills, text (aligned, wrapped, overflowing
// into empty neighbours like Excel), and borders. Pure: a workbook in, a PdfDrawing out.
import { PageDraw, PdfDrawing, measure, type FontSpec, type PreparedFont, type Rgb } from '@ream/pdf-core'
import { UserError } from '@ream/core'
import type { Cell, Edge, Sheet, Style } from '@ream/office-core'
import { familyOf, hexRgb, widthScale } from '../office-fonts.ts'

export type LayoutOptions = {
  /** portrait size in points */
  page: [number, number]
  orientation: 'auto' | 'portrait' | 'landscape'
  /** 'width' shrinks a wide sheet to the page; 'none' keeps the size and continues on further pages */
  fit: 'width' | 'none'
  gridlines: boolean
  /** points */
  margin: number
}

const PAD = 2
const MAX_PAGES = 1000
const EDGE_WIDTH: Record<Edge, number> = { thin: 0.5, medium: 1, thick: 1.75 }
/** Excel's column width in characters to points (7 px per digit plus 5 px of padding, 0.75 pt per px) */
const widthPts = (chars: number) => (chars * 7 + 5) * 0.75

const blank = (c: Cell | null | undefined) => !c || c.value === null || c.value === ''
const shown = (c: Cell) => c.text ?? (c.value === null ? '' : String(c.value))

/** text broken into lines that fit `width`: at newlines, then at spaces, then inside a word that is too long */
function wrap(text: string, width: number, size: number, font: FontSpec, emb: PreparedFont | null): string[] {
  const out: string[] = []
  for (const para of text.split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/(?<= )/)) {
      if (!line || measure((line + word).trimEnd(), size, font, emb) <= width) line += word
      else {
        out.push(line.trimEnd())
        line = word
      }
      while (line && measure(line.trimEnd(), size, font, emb) > width && [...line].length > 1) {
        let cut = [...line]
        while (cut.length > 1 && measure(cut.join(''), size, font, emb) > width) cut = cut.slice(0, -1)
        out.push(cut.join(''))
        line = [...line].slice(cut.length).join('')
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

const fontOf = (s: Style | undefined, emb: PreparedFont | null): FontSpec => ({ family: emb ? 'custom' : familyOf(s?.font), bold: s?.bold, italic: s?.italic, scale: emb ? 1 : widthScale(s?.font) })

/** every text in the workbook, for cutting an embedded font down to the glyphs it needs */
export const allText = (sheets: Sheet[]) => sheets.flatMap((s) => s.rows.flatMap((r) => r.flatMap((c) => (c ? [shown(c)] : [])))).join('')

export function layoutSheet(d: PdfDrawing, sh: Sheet, o: LayoutOptions, emb: PreparedFont | null): number {
  const hiddenC = new Set(sh.hiddenCols)
  const hiddenR = new Set(sh.hiddenRows)
  // the used range: cells with something in them, a colour or a line
  let maxR = -1
  let maxC = -1
  sh.rows.forEach((row, r) => row.forEach((c, k) => {
    if (c && (!blank(c) || c.style?.fill || c.style?.border)) { maxR = Math.max(maxR, r); maxC = Math.max(maxC, k) }
  }))
  if (maxR < 0 || maxC < 0) return 0
  // merged ranges are cut to the used range: a file can declare one the size of the whole sheet
  const merges = new Map<string, NonNullable<Sheet['merges']>[number]>()
  const covered = new Set<string>()
  for (const m0 of sh.merges ?? []) {
    if (m0.row > maxR || m0.col > maxC) continue
    const m = { ...m0, rows: Math.min(m0.rows, maxR + 1 - m0.row), cols: Math.min(m0.cols, maxC + 1 - m0.col) }
    merges.set(`${m.row}:${m.col}`, m)
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) if (r || c) covered.add(`${m.row + r}:${m.col + c}`)
  }
  const cols = Array.from({ length: maxC + 1 }, (_, i) => i).filter((c) => !hiddenC.has(c))
  const rowsIdx = Array.from({ length: maxR + 1 }, (_, i) => i).filter((r) => !hiddenR.has(r))
  const colW = new Map(cols.map((c) => [c, widthPts(sh.colWidths?.[c] ?? sh.defaultColWidth ?? 8.43)]))
  const spanW = (c: number, n: number) => { let w = 0; for (let k = 0; k < n; k++) w += colW.get(c + k) ?? 0; return w }

  // row heights: as the file says, else big enough for the biggest type and for wrapped text
  const defaultH = sh.defaultRowHeight ?? 15
  const rowH = new Map<number, number>()
  for (const r of rowsIdx) {
    let h = sh.rowHeights?.[r] ?? 0
    if (!h) {
      h = defaultH
      for (const [c, cell] of (sh.rows[r] ?? []).entries()) {
        if (!cell || blank(cell) || covered.has(`${r}:${c}`)) continue
        const size = cell.style?.size ?? 11
        h = Math.max(h, size * 1.3)
        if (cell.style?.wrap) {
          const m = merges.get(`${r}:${c}`)
          const lines = wrap(shown(cell), (m ? spanW(c, m.cols) : colW.get(c) ?? 0) - 2 * PAD, size, fontOf(cell.style, emb), emb).length
          h = Math.max(h, lines * size * 1.2 + 3)
        }
      }
    }
    rowH.set(r, h)
  }

  // page, scale and where the pages break
  const totalW = cols.reduce((n, c) => n + colW.get(c)!, 0)
  const [pw, ph] = o.page
  const portraitContent = Math.min(pw, ph) - 2 * o.margin
  const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && (sh.landscape || totalW > portraitContent))
  const [W, H] = landscape ? [Math.max(pw, ph), Math.min(pw, ph)] : [Math.min(pw, ph), Math.max(pw, ph)]
  const cw = W - 2 * o.margin
  const ch = H - 2 * o.margin
  if (cw < 20 || ch < 20) throw new UserError('The margin is too big for this paper size.')
  const s = o.fit === 'width' ? Math.min(1, cw / totalW) : 1
  const groups = <T,>(items: T[], size: (t: T) => number, limit: number) => {
    const out: T[][] = []
    let cur: T[] = []
    let used = 0
    for (const it of items) {
      if (cur.length && used + size(it) > limit + 0.01) { out.push(cur); cur = []; used = 0 }
      cur.push(it)
      used += size(it)
    }
    if (cur.length) out.push(cur)
    return out
  }
  const colGroups = groups(cols, (c) => colW.get(c)! * s, cw)
  const rowGroups = groups(rowsIdx, (r) => rowH.get(r)! * s, ch)
  if (colGroups.length * rowGroups.length > MAX_PAGES) throw new UserError(`This sheet needs over ${MAX_PAGES} pages. Choose "Fit to page width" or a larger paper size.`)

  for (const cg of colGroups) {
    for (const rg of rowGroups) {
      const page = d.addPage(W, H)
      drawPage(page, sh, cg, rg, { colW, rowH, merges, covered, s, margin: o.margin, gridlines: o.gridlines, emb })
    }
  }
  return colGroups.length * rowGroups.length
}

type Env = { colW: Map<number, number>; rowH: Map<number, number>; merges: Map<string, { row: number; col: number; rows: number; cols: number }>; covered: Set<string>; s: number; margin: number; gridlines: boolean; emb: PreparedFont | null }

function drawPage(page: PageDraw, sh: Sheet, cg: number[], rg: number[], e: Env) {
  const { s } = e
  const xAt = new Map<number, number>()
  const yAt = new Map<number, number>()
  let x = e.margin
  for (const c of cg) { xAt.set(c, x); x += e.colW.get(c)! * s }
  const right = x
  let y = e.margin
  for (const r of rg) { yAt.set(r, y); y += e.rowH.get(r)! * s }
  const bottom = y
  const inCols = new Set(cg)
  const inRows = new Set(rg)

  /** the rectangle a cell covers (a merged cell covers all its parts that are on this page) */
  const rectOf = (r: number, c: number) => {
    const m = e.merges.get(`${r}:${c}`)
    const rows = m ? Array.from({ length: m.rows }, (_, i) => r + i).filter((i) => inRows.has(i)) : [r]
    const cs = m ? Array.from({ length: m.cols }, (_, i) => c + i).filter((i) => inCols.has(i)) : [c]
    const x0 = xAt.get(cs[0])!
    const y0 = yAt.get(rows[0])!
    const x1 = xAt.get(cs[cs.length - 1])! + e.colW.get(cs[cs.length - 1])! * s
    const y1 = yAt.get(rows[rows.length - 1])! + e.rowH.get(rows[rows.length - 1])! * s
    return { x0, y0, x1, y1 }
  }

  if (e.gridlines) {
    for (const c of cg) page.line(xAt.get(c)!, e.margin, xAt.get(c)!, bottom, 0.25, [208, 208, 208])
    for (const r of rg) page.line(e.margin, yAt.get(r)!, right, yAt.get(r)!, 0.25, [208, 208, 208])
    page.line(right, e.margin, right, bottom, 0.25, [208, 208, 208])
    page.line(e.margin, bottom, right, bottom, 0.25, [208, 208, 208])
  }
  const cells: { r: number; c: number; cell: Cell }[] = []
  for (const r of rg) for (const c of cg) {
    const cell = sh.rows[r]?.[c]
    if (cell && (!e.covered.has(`${r}:${c}`) || cell.style?.fill || cell.style?.border)) cells.push({ r, c, cell })
  }
  // a merged cell takes the look of its first cell; the other parts of it are drawn only for their lines
  for (const { r, c, cell } of cells) {
    if (e.covered.has(`${r}:${c}`) || !cell.style?.fill) continue
    const b = rectOf(r, c)
    page.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, hexRgb(cell.style.fill, [255, 255, 255]))
  }
  for (const { r, c, cell } of cells) {
    if (e.covered.has(`${r}:${c}`) || blank(cell)) continue
    drawText(page, sh, r, c, cell, rectOf(r, c), { ...e, inCols, inRows, xAt, rectOf }, cg, rg)
  }
  for (const { r, c, cell } of cells) {
    const b = cell.style?.border
    if (!b) continue
    // covered parts of a merge draw only the edges that lie on the merge's outside
    const box = e.covered.has(`${r}:${c}`) ? { x0: xAt.get(c)!, y0: yAt.get(r)!, x1: xAt.get(c)! + e.colW.get(c)! * s, y1: yAt.get(r)! + e.rowH.get(r)! * s } : rectOf(r, c)
    const line = (edge: Edge | undefined, x0: number, y0: number, x1: number, y1: number) => edge && page.line(x0, y0, x1, y1, EDGE_WIDTH[edge] * Math.max(s, 0.6), [0, 0, 0])
    line(b.top, box.x0, box.y0, box.x1, box.y0)
    line(b.bottom, box.x0, box.y1, box.x1, box.y1)
    line(b.left, box.x0, box.y0, box.x0, box.y1)
    line(b.right, box.x1, box.y0, box.x1, box.y1)
  }
}

type TextEnv = Env & { inCols: Set<number>; inRows: Set<number>; xAt: Map<number, number>; rectOf: (r: number, c: number) => { x0: number; y0: number; x1: number; y1: number } }

function drawText(page: PageDraw, sh: Sheet, r: number, c: number, cell: Cell, box: { x0: number; y0: number; x1: number; y1: number }, e: TextEnv, cg: number[], rg: number[]) {
  const st = cell.style ?? {}
  const size = (st.size ?? 11) * e.s
  const font = fontOf(st, e.emb)
  const color: Rgb = hexRgb(st.color)
  const isNumber = typeof cell.value === 'number'
  const align = st.align ?? (isNumber ? 'right' : typeof cell.value === 'boolean' ? 'center' : 'left')
  const innerW = box.x1 - box.x0 - 2 * PAD * e.s
  let text = shown(cell)
  let lines: string[]
  let clip = { ...box }
  if (st.wrap) lines = wrap(text, innerW, size, font, e.emb)
  else {
    lines = [text.replace(/\r?\n/g, ' ')]
    const w = measure(lines[0], size, font, e.emb)
    if (isNumber && w > innerW) {
      // Excel shows #### where a number does not fit
      const hash = measure('#', size, font, e.emb) || size * 0.6
      lines = ['#'.repeat(Math.max(1, Math.floor(innerW / hash)))]
    } else if (!isNumber && w > innerW) {
      // text runs on into empty cells next to it; which side depends on the alignment
      const m = e.merges.get(`${r}:${c}`)
      const first = c + (m?.cols ?? 1)
      const empty = (rr: number, cc: number) => blank(sh.rows[rr]?.[cc]) && !e.covered.has(`${rr}:${cc}`) && !e.merges.has(`${rr}:${cc}`)
      if (align !== 'right') for (let k = first; cg.includes(k) && empty(r, k); k++) clip.x1 = e.xAt.get(k)! + e.colW.get(k)! * e.s
      if (align !== 'left') for (let k = c - 1; cg.includes(k) && empty(r, k); k--) clip.x0 = e.xAt.get(k)!
    }
  }
  text = lines.join('\n')
  const lineH = size * 1.2
  const block = lines.length * lineH
  const ch = box.y1 - box.y0
  const valign = st.valign ?? 'bottom'
  const top = valign === 'top' ? box.y0 + 1 : valign === 'center' ? box.y0 + (ch - block) / 2 : box.y1 - 1 - block
  page.save()
  page.clip(clip.x0, clip.y0, clip.x1 - clip.x0, clip.y1 - clip.y0)
  lines.forEach((line, i) => {
    const w = measure(line, size, font, e.emb)
    const x = align === 'right' ? box.x1 - PAD * e.s - w : align === 'center' ? (box.x0 + box.x1) / 2 - w / 2 : box.x0 + PAD * e.s
    page.text(x, top + i * lineH + 0.87 * size, line, font, size, color)
    if (st.underline) page.line(x, top + i * lineH + size, x + w, top + i * lineH + size, 0.5, color)
  })
  page.restore()
}
