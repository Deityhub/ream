// Read a workbook (.xlsx): sheets with their cells, looks, widths and merged ranges. Formulas show the value Excel stored.
import { UserError, unzip } from '@ream/core'
import { BUILTIN_FORMATS, formatValue } from './numfmt.ts'
import { DEFAULT_THEME, parseRef, readRels, readTheme, relsOf, sheetColor, type Theme } from './ooxml.ts'
import type { Cell, Edge, Merge, Sheet, Style } from './xlsx-model.ts'
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
    font: child(f, 'name')?.attrs.val,
    color: sheetColor(child(f, 'color'), theme),
  }))
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

function readSheet(name: string, root: XmlNode, strings: string[], xfs: Style[], date1904: boolean, hidden: boolean): Sheet {
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
      row[col] = { value, style, text: formatValue(value, style.numFmt, date1904) }
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
    defaultRowHeight: fmtPr?.attrs.defaultRowHeight ? num(fmtPr, 'defaultRowHeight', 15) : 15,
    defaultColWidth: fmtPr?.attrs.defaultColWidth ? num(fmtPr, 'defaultColWidth', 8.43) : 8.43,
    hidden,
  }
}

/** every sheet of a workbook; chart sheets, charts, pictures and conditional formatting are not read */
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
  const sheets: Sheet[] = []
  for (const s of kids(child(book, 'sheets'), 'sheet')) {
    const rel = bookRels.get(s.attrs.id ?? '')
    const root = rel ? xml(rel.part) : undefined
    if (!root || root.name !== 'worksheet') continue // chart sheets and the like
    sheets.push(readSheet(s.attrs.name ?? `Sheet${sheets.length + 1}`, root, strings, xfs, date1904, s.attrs.state === 'hidden' || s.attrs.state === 'veryHidden'))
  }
  if (!sheets.length) throw new UserError('This workbook has no sheets that can be read.')
  return { sheets, date1904 }
}
