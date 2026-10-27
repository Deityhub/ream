// A spreadsheet laid out on pages: columns and rows from the file's sizes, cell fills, text (aligned, wrapped, overflowing
// into empty neighbours like Excel), and borders. Pure: a workbook in, a PdfDrawing out.
import { PageDraw, PdfDrawing, measure, type FontSpec, type Rgb } from '@ream/pdf-core'
import { UserError } from '@ream/core'
import type { Cell, Chart, Edge, Sheet, SheetPicture, Style } from '@ream/office-core'
import { chartFontNeeds, drawChart } from '../office-charts.ts'
import { hexRgb } from '../office-fonts.ts'
import type { FontBook, FontNeed } from '../fonts/book.ts'

export type LayoutOptions = {
  /** portrait size in points */
  page: [number, number]
  orientation: 'auto' | 'portrait' | 'landscape'
  /** 'width' shrinks a wide sheet to the page; 'none' keeps the size (times `scale`) and continues on further pages; or
   * shrink to so many pages wide and tall (0: as many as it takes), as Excel's "Fit to" does */
  fit: 'width' | 'none' | { wide: number; tall: number }
  /** with fit 'none': 1 is the real size */
  scale?: number
  gridlines: boolean
  /** points */
  margins: { left: number; right: number; top: number; bottom: number }
  /** each page's columns centred across it */
  centered?: boolean
}

const PAD = 1.5 // Excel keeps about 2 px each side of a cell (its 5 px of padding, less the grid line)
const MAX_PAGES = 1000
const EDGE_WIDTH: Record<Edge, number> = { thin: 0.5, medium: 1, thick: 1.75 }
/** Excel's column width in characters to points (7 px per digit plus 5 px of padding, 0.75 pt per px) */
const widthPts = (chars: number) => (chars * 7 + 5) * 0.75

const blank = (c: Cell | null | undefined) => !c || c.value === null || c.value === ''
const shown = (c: Cell) => c.text ?? (c.value === null ? '' : String(c.value))

/** text broken into lines that fit `width`: at newlines, then at spaces, then inside a word that is too long */
function wrap(text: string, width: number, size: number, font: FontSpec): string[] {
  const out: string[] = []
  for (const para of text.split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/(?<= )/)) {
      if (!line || measure((line + word).trimEnd(), size, font) <= width) line += word
      else {
        out.push(line.trimEnd())
        line = word
      }
      while (line && measure(line.trimEnd(), size, font) > width && [...line].length > 1) {
        let cut = [...line]
        while (cut.length > 1 && measure(cut.join(''), size, font) > width) cut = cut.slice(0, -1)
        out.push(cut.join(''))
        line = [...line].slice(cut.length).join('')
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

const fontOf = (s: Style | undefined, book: FontBook): FontSpec => book.spec(s?.font, s?.bold, s?.italic)

/** the fonts the workbook's cells need, with their text, for the font book to load */
export const fontNeeds = (sheets: Sheet[]): FontNeed[] => sheets.flatMap((s) => [
  ...s.rows.flatMap((r) => r.flatMap((c) => (c ? [{ name: c.style?.font, bold: c.style?.bold, italic: c.style?.italic, text: shown(c) + '#' }] : []))),
  ...(s.charts ?? []).flatMap((c) => chartFontNeeds(c.chart)),
])

/** `imageId` gives the drawing's id of a decoded picture, or null for one that can't be shown */
export function layoutSheet(d: PdfDrawing, sh: Sheet, o: LayoutOptions, book: FontBook, imageId: (p: SheetPicture) => number | null = () => null): number {
  const hiddenC = new Set(sh.hiddenCols)
  const hiddenR = new Set(sh.hiddenRows)
  // the used range: cells with something in them, a colour or a line
  let maxR = -1
  let maxC = -1
  sh.rows.forEach((row, r) => row.forEach((c, k) => {
    if (c && (!blank(c) || c.style?.fill || c.style?.border)) { maxR = Math.max(maxR, r); maxC = Math.max(maxC, k) }
  }))
  // pictures and charts count as used too; one with no end cell is reckoned in default-sized cells
  for (const p of [...(sh.pictures ?? []), ...(sh.charts ?? [])]) {
    const end = p.to ?? { row: p.from.row + Math.ceil((p.from.dy + p.height) / (sh.defaultRowHeight ?? 15)) - 1, col: p.from.col + Math.ceil((p.from.dx + p.width) / widthPts(sh.defaultColWidth ?? 8.43)) - 1 }
    maxR = Math.max(maxR, end.row)
    maxC = Math.max(maxC, end.col)
  }
  if (maxR < 0 || maxC < 0) return 0
  // a print area prints just that, blank cells too
  const area = sh.page?.area
  if (area) { maxR = area.row + area.rows - 1; maxC = area.col + area.cols - 1 }
  // merged ranges are cut to the used range: a file can declare one the size of the whole sheet
  const merges = new Map<string, NonNullable<Sheet['merges']>[number]>()
  const covered = new Set<string>()
  for (const m0 of sh.merges ?? []) {
    if (m0.row > maxR || m0.col > maxC) continue
    const m = { ...m0, rows: Math.min(m0.rows, maxR + 1 - m0.row), cols: Math.min(m0.cols, maxC + 1 - m0.col) }
    merges.set(`${m.row}:${m.col}`, m)
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) if (r || c) covered.add(`${m.row + r}:${m.col + c}`)
  }
  const [r0, c0] = area ? [area.row, area.col] : [0, 0]
  const cols = Array.from({ length: maxC + 1 - c0 }, (_, i) => c0 + i).filter((c) => !hiddenC.has(c))
  const rowsIdx = Array.from({ length: maxR + 1 - r0 }, (_, i) => r0 + i).filter((r) => !hiddenR.has(r))
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
          const lines = wrap(shown(cell), (m ? spanW(c, m.cols) : colW.get(c) ?? 0) - 2 * PAD, size, fontOf(cell.style, book)).length
          h = Math.max(h, lines * size * 1.2 + 3)
        }
      }
    }
    rowH.set(r, h)
  }

  // page, scale and where the pages break
  const totalW = cols.reduce((n, c) => n + colW.get(c)!, 0)
  const [pw, ph] = o.page
  const mg = o.margins
  const portraitContent = Math.min(pw, ph) - mg.left - mg.right
  const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && (sh.landscape || totalW > portraitContent))
  const [W, H] = landscape ? [Math.max(pw, ph), Math.min(pw, ph)] : [Math.min(pw, ph), Math.max(pw, ph)]
  const cw = W - mg.left - mg.right
  // rows repeated at the top of every page take their room from each page
  const tr = sh.page?.titleRows
  const titles = tr ? rowsIdx.filter((r) => r >= tr[0] && r <= tr[1]) : []
  const body = rowsIdx.filter((r) => !titles.includes(r))
  const titleH = titles.reduce((n, r) => n + rowH.get(r)!, 0)
  const ch = H - mg.top - mg.bottom
  if (cw < 20 || ch < 20) throw new UserError('The margins are too big for this paper size.')
  const totalH = rowsIdx.reduce((n, r) => n + rowH.get(r)!, 0)
  const f = o.fit
  // ponytail: "fit to N pages" scales by the sheet's total size, so a page break that falls badly can still add a page; Excel searches for the scale
  const s = f === 'width' ? Math.min(1, cw / totalW) : f === 'none' ? (o.scale ?? 1) : Math.min(1, f.wide ? (cw * f.wide) / totalW : 1, f.tall ? (ch * f.tall) / totalH : 1)
  if (titleH * s > ch / 2) throw new UserError('The rows repeated on every page take more than half the page. Change "Rows to repeat at top" in Excel, then try again.')
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
  const rowGroups = titles.length ? groups(body, (r) => rowH.get(r)! * s, ch - titleH * s).map((g) => [...new Set([...titles, ...g])].sort((a, b) => a - b)) : groups(rowsIdx, (r) => rowH.get(r)! * s, ch)
  if (colGroups.length * rowGroups.length > MAX_PAGES) throw new UserError(`This sheet needs over ${MAX_PAGES} pages. Choose "Fit to page width" or a larger paper size.`)

  // where each column and row starts on the sheet at full size, hidden ones taking no room; pictures are placed by these
  const colPos = new Map<number, number>()
  const rowPos = new Map<number, number>()
  for (let c = c0, x = 0; c <= maxC + 1; c++) { colPos.set(c, x); x += colW.get(c) ?? 0 }
  for (let r = r0, y = 0; r <= maxR + 1; r++) { rowPos.set(r, y); y += rowH.get(r) ?? 0 }
  const at = (a: SheetPicture['from']) => ({ x: (colPos.get(a.col) ?? 0) + a.dx, y: (rowPos.get(a.row) ?? 0) + a.dy })
  const pics: Pic[] = []
  for (const p of sh.pictures ?? []) {
    const id = imageId(p)
    if (id === null) continue
    const a = at(p.from)
    const b = p.to ? at(p.to) : { x: a.x + p.width, y: a.y + p.height }
    if (b.x > a.x && b.y > a.y) pics.push({ id, x0: a.x, y0: a.y, x1: b.x, y1: b.y })
  }
  for (const ch of sh.charts ?? []) {
    const a = at(ch.from)
    const b = ch.to ? at(ch.to) : { x: a.x + ch.width, y: a.y + ch.height }
    if (b.x > a.x && b.y > a.y) pics.push({ chart: ch.chart, x0: a.x, y0: a.y, x1: b.x, y1: b.y })
  }

  for (const cg of colGroups) {
    for (const rg of rowGroups) {
      const page = d.addPage(W, H)
      const left = o.centered ? mg.left + Math.max(0, (cw - cg.reduce((n, c) => n + colW.get(c)! * s, 0)) / 2) : mg.left
      drawPage(page, sh, cg, rg, { colW, rowH, merges, covered, s, left, top: mg.top, gridlines: o.gridlines, book, pics, colPos, rowPos, titles: new Set(titles) })
    }
  }
  return colGroups.length * rowGroups.length
}

type Env = { colW: Map<number, number>; rowH: Map<number, number>; merges: Map<string, { row: number; col: number; rows: number; cols: number }>; covered: Set<string>; s: number; left: number; top: number; gridlines: boolean; book: FontBook; pics: Pic[]; colPos: Map<number, number>; rowPos: Map<number, number>; titles: Set<number> }
/** a picture's or chart's place on the sheet at full size, points */
type Pic = { id?: number; chart?: Chart; x0: number; y0: number; x1: number; y1: number }

function drawPage(page: PageDraw, sh: Sheet, cg: number[], rg: number[], e: Env) {
  const { s } = e
  const xAt = new Map<number, number>()
  const yAt = new Map<number, number>()
  let x = e.left
  for (const c of cg) { xAt.set(c, x); x += e.colW.get(c)! * s }
  const right = x
  let y = e.top
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
    for (const c of cg) page.line(xAt.get(c)!, e.top, xAt.get(c)!, bottom, 0.25, [208, 208, 208])
    for (const r of rg) page.line(e.left, yAt.get(r)!, right, yAt.get(r)!, 0.25, [208, 208, 208])
    page.line(right, e.top, right, bottom, 0.25, [208, 208, 208])
    page.line(e.left, bottom, right, bottom, 0.25, [208, 208, 208])
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
  // pictures and charts float over the cells; one that crosses a page break is cut there and goes on on the next page. Repeated
  // title rows don't repeat pictures.
  const first = rg.find((r) => !e.titles.has(r)) ?? rg[0]
  const ox = e.left - e.colPos.get(cg[0])! * s
  const oy = yAt.get(first)! - e.rowPos.get(first)! * s
  const clip = { x0: e.left, y0: yAt.get(first)!, x1: right, y1: bottom }
  const shown = e.pics.filter((p) => ox + p.x1 * s > clip.x0 && ox + p.x0 * s < clip.x1 && oy + p.y1 * s > clip.y0 && oy + p.y0 * s < clip.y1)
  if (shown.length) {
    page.save()
    page.clip(clip.x0, clip.y0, clip.x1 - clip.x0, clip.y1 - clip.y0)
    for (const p of shown) {
      if (p.id !== undefined) page.image(p.id, ox + p.x0 * s, oy + p.y0 * s, (p.x1 - p.x0) * s, (p.y1 - p.y0) * s)
      else if (p.chart) {
        // a chart is drawn at the sheet's own size and scaled with it, text included
        page.save()
        page.transform(s, 0, 0, s, ox, oy)
        drawChart(page, p.chart, { x: p.x0, y: p.y0, w: p.x1 - p.x0, h: p.y1 - p.y0 }, e.book, { fill: 'FFFFFF', line: 'D9D9D9' })
        page.restore()
      }
    }
    page.restore()
  }
}

type TextEnv = Env & { inCols: Set<number>; inRows: Set<number>; xAt: Map<number, number>; rectOf: (r: number, c: number) => { x0: number; y0: number; x1: number; y1: number } }

function drawText(page: PageDraw, sh: Sheet, r: number, c: number, cell: Cell, box: { x0: number; y0: number; x1: number; y1: number }, e: TextEnv, cg: number[], rg: number[]) {
  const st = cell.style ?? {}
  const size = (st.size ?? 11) * e.s
  const font = fontOf(st, e.book)
  const color: Rgb = hexRgb(st.color)
  const isNumber = typeof cell.value === 'number'
  const align = st.align ?? (isNumber ? 'right' : typeof cell.value === 'boolean' ? 'center' : 'left')
  const innerW = box.x1 - box.x0 - 2 * PAD * e.s
  let text = shown(cell)
  let lines: string[]
  let clip = { ...box }
  if (st.wrap) lines = wrap(text, innerW, size, font)
  else {
    lines = [text.replace(/\r?\n/g, ' ')]
    const w = measure(lines[0], size, font)
    if (isNumber && w > innerW) {
      // Excel shows #### where a number does not fit
      const hash = measure('#', size, font) || size * 0.6
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
    const w = measure(line, size, font)
    const x = align === 'right' ? box.x1 - PAD * e.s - w : align === 'center' ? (box.x0 + box.x1) / 2 - w / 2 : box.x0 + PAD * e.s
    page.text(x, top + i * lineH + 0.87 * size, line, font, size, color)
    if (st.underline) page.line(x, top + i * lineH + size, x + w, top + i * lineH + size, 0.5, color)
  })
  page.restore()
}
