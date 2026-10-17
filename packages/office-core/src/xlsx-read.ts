// Read a workbook (.xlsx): sheets with their cells, looks, widths and merged ranges. Formulas show the value Excel stored.
import { UserError, unzip } from '@ream/core'
import { BUILTIN_FORMATS, formatColor, formatValue } from './numfmt.ts'
import { DEFAULT_THEME, parseRef, readRels, readTheme, relsOf, sheetColor, type Theme } from './ooxml.ts'
import type { Anchor, Cell, Edge, Merge, PageSetup, Sheet, SheetChart, SheetPicture, Style } from './xlsx-model.ts'
import { readChart, type ChartLookup } from './chart-read.ts'
import type { ColorContext } from './drawingml.ts'
import { child, dig, kids, num, parseXml, type XmlNode } from './xml.ts'

const MAX_CELLS = 2_000_000
const MAX_ROWS = 1_048_576
const MAX_COLS = 16_384
const OFFICE_DOC = 'officeDocument'

export type Workbook = { sheets: Sheet[]; date1904: boolean }

const text = (n: XmlNode | undefined): string => (n ? (n.name === 't' ? n.text : n.children.filter((c) => c.name === 't' || c.name === 'r' || c.name === 'is').map(text).join('')) : '')

/** the text of a shared string or inline string: plain <t>, or runs <r><t>; phonetic runs (rPh) are left out */
const richText = (si: XmlNode): string => si.children.filter((c) => c.name === 't' || c.name === 'r').map((c) => (c.name === 't' ? c.text : text(child(c, 't')))).join('')

const EDGE: Record<string, Edge | undefined> = { thin: 'thin', hair: 'thin', dotted: 'thin', dashed: 'thin', dashDot: 'thin', dashDotDot: 'thin', medium: 'medium', mediumDashed: 'medium', mediumDashDot: 'medium', mediumDashDotDot: 'medium', slantDashDot: 'medium', double: 'medium', thick: 'thick' }

function readStyles(root: XmlNode | undefined, theme: Theme) {
  const formats = new Map<number, string>()
  for (const f of kids(child(root, 'numFmts'), 'numFmt')) formats.set(num(f, 'numFmtId'), f.attrs.formatCode ?? 'General')
  const on = (n: XmlNode | undefined) => n !== undefined && n.attrs.val !== '0' && n.attrs.val !== 'false'
  const fonts = kids(child(root, 'fonts'), 'font').map((f): Style => ({
    bold: on(child(f, 'b')),
    italic: on(child(f, 'i')),
    underline: child(f, 'u') !== undefined && child(f, 'u')!.attrs.val !== 'none',
    size: child(f, 'sz') ? num(child(f, 'sz'), 'val', 11) : undefined,
    // a theme font (scheme) is shown in the theme's font, whatever name was saved with it
    font: child(f, 'scheme')?.attrs.val === 'major' ? theme.major : child(f, 'scheme')?.attrs.val === 'minor' ? theme.minor : child(f, 'name')?.attrs.val,
    color: sheetColor(child(f, 'color'), theme),
  }))
  // a font with no name is in the workbook's default font (the first one), which is what Excel shows
  for (const f of fonts) f.font ??= fonts[0]?.font
  const fills = kids(child(root, 'fills'), 'fill').map((f) => {
    const p = child(f, 'patternFill')
    return p?.attrs.patternType === 'solid' ? sheetColor(child(p, 'fgColor'), theme) : undefined
  })
  const borders = kids(child(root, 'borders'), 'border').map((b) => {
    const out: NonNullable<Style['border']> = {}
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const e = child(b, side)
      const edge = e?.attrs.style ? EDGE[e.attrs.style] : undefined
      if (edge) out[side] = edge
    }
    return out
  })
  const xfs = kids(child(root, 'cellXfs'), 'xf').map((x): Style => {
    const font = fonts[num(x, 'fontId')] ?? {}
    const a = child(x, 'alignment')
    const id = num(x, 'numFmtId')
    const style: Style = { ...font, fill: fills[num(x, 'fillId')], border: borders[num(x, 'borderId')], numFmt: id === 0 ? undefined : (formats.get(id) ?? BUILTIN_FORMATS[id]) }
    if (a?.attrs.horizontal && ['left', 'center', 'right'].includes(a.attrs.horizontal)) style.align = a.attrs.horizontal as Style['align']
    if (a?.attrs.vertical) style.valign = a.attrs.vertical === 'center' ? 'center' : a.attrs.vertical === 'top' ? 'top' : 'bottom'
    if (a?.attrs.wrapText === '1' || a?.attrs.wrapText === 'true') style.wrap = true
    if (!Object.keys(style.border ?? {}).length) delete style.border
    return Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined && v !== false)) as Style
  })
  return xfs
}

/** "A1:C3" or "B2" -> merge rectangle */
function mergeOf(ref: string): Merge | null {
  const [a, b = a] = ref.split(':')
  const p = parseRef(a)
  const q = parseRef(b)
  return p && q && q.row >= p.row && q.col >= p.col ? { row: p.row, col: p.col, rows: q.row - p.row + 1, cols: q.col - p.col + 1 } : null
}

/** Excel's paper size numbers to portrait points */
const PAPER: Record<string, [number, number]> = { 1: [612, 792], 3: [792, 1224], 5: [612, 1008], 7: [522, 756], 8: [842, 1191], 9: [595, 842], 11: [420, 595], 12: [729, 1032], 13: [516, 729] }

/** the ranges of a defined name like 'My sheet'!$A$1:$D$9,'My sheet'!$1:$2, without the sheet names */
const rangesOf = (formula: string) => formula.split(/,(?=(?:[^']*'[^']*')*[^']*$)/).map((p) => p.slice(p.lastIndexOf('!') + 1).trim())

function pageSetup(root: XmlNode, names: { area?: string; titles?: string }): PageSetup {
  const ps = dig(root, 'pageSetup')
  const m = child(root, 'pageMargins')
  const inch = (k: string, d: number) => (m?.attrs[k] ? num(m, k, d) : d) * 72
  const opts = child(root, 'printOptions')
  const yes = (v: string | undefined) => v === '1' || v === 'true'
  const out: PageSetup = {
    // margins are always written, so only a page setup or "fit to" says the sheet was set up for printing
    saved: !!ps || yes(dig(root, 'sheetPr', 'pageSetUpPr')?.attrs.fitToPage),
    paper: PAPER[ps?.attrs.paperSize ?? ''],
    landscape: ps?.attrs.orientation === 'landscape',
    // Excel's "Normal" margins when the file has none
    margins: { left: inch('left', 0.7), right: inch('right', 0.7), top: inch('top', 0.75), bottom: inch('bottom', 0.75) },
    scale: Math.min(400, Math.max(10, ps?.attrs.scale ? num(ps, 'scale', 100) : 100)),
    gridlines: yes(opts?.attrs.gridLines),
    centered: yes(opts?.attrs.horizontalCentered),
  }
  if (yes(dig(root, 'sheetPr', 'pageSetUpPr')?.attrs.fitToPage)) out.fit = { wide: ps?.attrs.fitToWidth ? num(ps, 'fitToWidth', 1) : 1, tall: ps?.attrs.fitToHeight ? num(ps, 'fitToHeight', 1) : 1 }
  // ponytail: a print area of several ranges prints its first one; Excel prints each on its own pages
  const area = names.area ? mergeOf(rangesOf(names.area)[0].replace(/\$/g, '')) : null
  if (area) out.area = area
  for (const r of names.titles ? rangesOf(names.titles) : []) {
    const rows = /^\$?(\d+):\$?(\d+)$/.exec(r)
    if (rows) out.titleRows = [Number(rows[1]) - 1, Number(rows[2]) - 1] // ponytail: repeated columns ($A:$B) are not repeated
  }
  return out
}

function readSheet(name: string, root: XmlNode, strings: string[], xfs: Style[], date1904: boolean, hidden: boolean, names: { area?: string; titles?: string } = {}): Sheet {
  const rows: (Cell | null)[][] = []
  const rowHeights: (number | undefined)[] = []
  const hiddenRows: number[] = []
  let budget = MAX_CELLS
  let nextRow = 0
  for (const r of kids(child(root, 'sheetData'), 'row')) {
    const at = r.attrs.r ? Number(r.attrs.r) - 1 : nextRow
    nextRow = at + 1
    if (at < 0 || at >= MAX_ROWS) continue
    if (r.attrs.ht && (r.attrs.customHeight === '1' || r.attrs.customHeight === 'true')) rowHeights[at] = num(r, 'ht')
    if (r.attrs.hidden === '1' || r.attrs.hidden === 'true') hiddenRows.push(at)
    const row: (Cell | null)[] = (rows[at] ??= [])
    let nextCol = 0
    for (const c of kids(r, 'c')) {
      const p = c.attrs.r ? parseRef(c.attrs.r) : null
      const col = p ? p.col : nextCol
      nextCol = col + 1
      if (col >= MAX_COLS) continue
      if (--budget < 0) throw new UserError('This spreadsheet has too many cells to read.')
      const style = xfs[num(c, 's')] ?? {}
      const raw = child(c, 'v')?.text
      const t = c.attrs.t ?? 'n'
      let value: Cell['value'] = null
      if (t === 's') value = strings[Number(raw)] ?? ''
      else if (t === 'inlineStr') value = richText(child(c, 'is') ?? c)
      else if (t === 'b') value = raw === '1'
      else if (t === 'str' || t === 'e') value = raw ?? ''
      else if (raw !== undefined && raw.trim() !== '') value = Number(raw)
      if (value === null && !style.fill && !style.border) continue // an empty cell matters only for its colour or lines
      if (typeof value === 'number' && Number.isNaN(value)) value = null
      const tint = formatColor(value, style.numFmt)
      row[col] = { value, style: tint ? { ...style, color: tint } : style, text: formatValue(value, style.numFmt, date1904) }
    }
  }
  const colWidths: (number | undefined)[] = []
  const hiddenCols: number[] = []
  for (const c of kids(child(root, 'cols'), 'col')) {
    const lo = num(c, 'min', 1) - 1
    const hi = Math.min(num(c, 'max', lo + 1) - 1, lo + 1024, MAX_COLS - 1)
    for (let i = lo; i <= hi; i++) {
      if (c.attrs.width) colWidths[i] = num(c, 'width')
      if (c.attrs.hidden === '1' || c.attrs.hidden === 'true') hiddenCols.push(i)
    }
  }
  const fmtPr = child(root, 'sheetFormatPr')
  const merges = kids(child(root, 'mergeCells'), 'mergeCell').map((m) => mergeOf(m.attrs.ref ?? '')).filter((m): m is Merge => !!m)
  return {
    name,
    rows,
    colWidths,
    rowHeights,
    merges,
    hiddenRows,
    hiddenCols,
    landscape: dig(root, 'pageSetup')?.attrs.orientation === 'landscape',
    page: pageSetup(root, names),
    defaultRowHeight: fmtPr?.attrs.defaultRowHeight ? num(fmtPr, 'defaultRowHeight', 15) : 15,
    defaultColWidth: fmtPr?.attrs.defaultColWidth ? num(fmtPr, 'defaultColWidth', 8.43) : 8.43,
    hidden,
  }
}

const EMU = 12700 // per point
/** a workbook has no colour map; Excel uses the usual one */
const SHEET_MAP: Record<string, string> = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }
const MAX_PICTURES = 500

/** the cells of a reference like 'My sheet'!$B$2:$B$6 (or a single cell), row by row; numbers as they are stored, with the first cell's format */
function cellLookup(sheets: Sheet[]): ChartLookup {
  return (ref) => {
    const at = ref.lastIndexOf('!')
    const name = at < 0 ? sheets[0]?.name : ref.slice(0, at).replace(/^'|'$/g, '').replace(/''/g, "'")
    const sheet = sheets.find((s) => s.name === name)
    const range = mergeOf(ref.slice(at + 1).replace(/\$/g, ''))
    if (!sheet || !range || range.rows * range.cols > 100_000) return null
    const values: string[] = []
    let format: string | undefined
    for (let r = range.row; r < range.row + range.rows; r++) {
      for (let c = range.col; c < range.col + range.cols; c++) {
        const cell = sheet.rows[r]?.[c]
        format ??= cell?.style?.numFmt
        values.push(cell == null || cell.value === null ? '' : typeof cell.value === 'number' ? String(cell.value) : (cell.text ?? String(cell.value)))
      }
    }
    return { values, format }
  }
}

/** the pictures and charts a sheet's drawing part places; shapes, text boxes and embedded objects in it are not read */
function readDrawing(drawing: XmlNode | undefined, rels: ReturnType<typeof readRels>, parts: Map<string, Uint8Array>, xml: (name: string) => XmlNode | undefined, colors: ColorContext, lookup: ChartLookup): { pictures: SheetPicture[]; charts: SheetChart[] } {
  const out: SheetPicture[] = []
  const charts: SheetChart[] = []
  const anchor = (n: XmlNode | undefined): Anchor | undefined => {
    const v = (k: string) => Number(child(n, k)?.text ?? 0) || 0
    return n ? { col: v('col'), row: v('row'), dx: v('colOff') / EMU, dy: v('rowOff') / EMU } : undefined
  }
  for (const a of drawing?.children ?? []) {
    if (out.length >= MAX_PICTURES) break
    if (a.name !== 'twoCellAnchor' && a.name !== 'oneCellAnchor' && a.name !== 'absoluteAnchor') continue
    const place = () => {
      const ext = child(a, 'ext') ?? dig(a, 'pic', 'spPr', 'xfrm', 'ext') ?? dig(a, 'graphicFrame', 'xfrm', 'ext')
      const pos = child(a, 'pos')
      // an absolute place is measured from the sheet's corner: cell A1 with an offset
      const from = a.name === 'absoluteAnchor' ? { col: 0, row: 0, dx: num(pos, 'x') / EMU, dy: num(pos, 'y') / EMU } : anchor(child(a, 'from'))!
      return { from, to: a.name === 'twoCellAnchor' ? anchor(child(a, 'to')) : undefined, width: num(ext, 'cx') / EMU, height: num(ext, 'cy') / EMU }
    }
    const frame = child(a, 'graphicFrame')
    if (frame) {
      const chartRel = rels.get(dig(frame, 'graphic', 'graphicData', 'chart')?.attrs.id ?? '')
      const chart = chartRel ? readChart(xml(chartRel.part), colors, lookup) : null
      if (chart) charts.push({ ...place(), chart })
      continue
    }
    const pic = child(a, 'pic')
    const rel = rels.get(dig(pic, 'blipFill', 'blip')?.attrs.embed ?? '')
    const bytes = rel && !rel.external ? parts.get(rel.part) : undefined
    if (!rel || !bytes) continue
    const ext2 = rel.part.split('.').pop()!.toLowerCase()
    out.push({ ...place(), bytes, type: ext2 === 'png' ? 'png' : ext2 === 'jpg' || ext2 === 'jpeg' ? 'jpeg' : 'other', name: rel.part })
  }
  return { pictures: out, charts }
}

/** every sheet of a workbook, with its pictures and charts; chart sheets, charts and conditional formatting are not read */
export async function readXlsx(bytes: Uint8Array): Promise<Workbook> {
  const parts = await unzip(bytes)
  const xml = (name: string): XmlNode | undefined => {
    const b = parts.get(name)
    return b ? parseXml(new TextDecoder().decode(b)) : undefined
  }
  if (parts.has('EncryptedPackage')) throw new UserError('This workbook is password protected. Remove the password in Excel, then try again.')
  const rels = readRels(xml('_rels/.rels'), '') // targets here are from the root of the package
  const bookPath = [...rels.values()].find((r) => r.type.endsWith(OFFICE_DOC))?.part
  const book = bookPath ? xml(bookPath) : undefined
  if (!bookPath || !book || book.name !== 'workbook') throw new UserError("This isn't an Excel workbook (.xlsx). Older .xls files must be saved as .xlsx first.")
  const bookRels = readRels(xml(relsOf(bookPath)), bookPath)
  const themePart = [...bookRels.values()].find((r) => r.type.endsWith('/theme'))?.part
  const theme = themePart ? readTheme(xml(themePart)) : DEFAULT_THEME
  const stylesPart = [...bookRels.values()].find((r) => r.type.endsWith('/styles'))?.part
  const xfs = readStyles(stylesPart ? xml(stylesPart) : undefined, theme)
  const sstPart = [...bookRels.values()].find((r) => r.type.endsWith('/sharedStrings'))?.part
  const strings = kids(sstPart ? xml(sstPart) : undefined, 'si').map(richText)
  const date1904 = dig(book, 'workbookPr')?.attrs.date1904 === '1'
  // print areas and repeated rows are names in the workbook, tied to a sheet by its place in the list
  const names = new Map<number, { area?: string; titles?: string }>()
  for (const n of kids(child(book, 'definedNames'), 'definedName')) {
    const at = Number(n.attrs.localSheetId)
    if (!Number.isInteger(at)) continue
    const entry = names.get(at) ?? {}
    if (n.attrs.name === '_xlnm.Print_Area') entry.area = n.text
    else if (n.attrs.name === '_xlnm.Print_Titles') entry.titles = n.text
    names.set(at, entry)
  }
  const sheets: Sheet[] = []
  const drawings: { sheet: Sheet; part: string }[] = []
  for (const [i, s] of kids(child(book, 'sheets'), 'sheet').entries()) {
    const rel = bookRels.get(s.attrs.id ?? '')
    const root = rel ? xml(rel.part) : undefined
    if (!root || root.name !== 'worksheet') continue // chart sheets and the like
    const sheet = readSheet(s.attrs.name ?? `Sheet${sheets.length + 1}`, root, strings, xfs, date1904, s.attrs.state === 'hidden' || s.attrs.state === 'veryHidden', names.get(i))
    const drawingRel = readRels(xml(relsOf(rel!.part)), rel!.part).get(child(root, 'drawing')?.attrs.id ?? '')
    if (drawingRel) drawings.push({ sheet, part: drawingRel.part })
    sheets.push(sheet)
  }
  // drawings last: a chart may show cells of a sheet further on
  const lookup = cellLookup(sheets)
  for (const { sheet, part } of drawings) {
    const { pictures, charts } = readDrawing(xml(part), readRels(xml(relsOf(part)), part), parts, xml, { theme, clrMap: SHEET_MAP }, lookup)
    if (pictures.length) sheet.pictures = pictures
    if (charts.length) sheet.charts = charts
  }
  if (!sheets.length) throw new UserError('This workbook has no sheets that can be read.')
  return { sheets, date1904 }
}
