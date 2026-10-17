// Write a workbook (.xlsx). Strings are stored inline (Excel turns them into shared strings when it saves).
import { zipPacked } from '@ream/core'
import { BUILTIN_FORMATS } from './numfmt.ts'
import { colName } from './ooxml.ts'
import type { Cell, Edge, Sheet, Style } from './xlsx-model.ts'
import { esc, fmt } from './xml.ts'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const MAX_CHARS = 32767
const FORMAT_IDS = new Map(Object.entries(BUILTIN_FORMATS).map(([id, code]) => [code, Number(id)]))

/** sheet names Excel accepts: at most 31 characters, none of []:*?/\, unique ignoring case */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((raw) => {
    const base = raw.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`
    used.add(name.toLowerCase())
    return name
  })
}

/** assigns each distinct look an index in styles.xml */
class Styles {
  fonts: string[] = [`<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>`]
  fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
  borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>']
  formats: string[] = []
  xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
  private seen = new Map<string, number>([['{}', 0]])
  private pool(list: string[], xml: string) {
    const i = list.indexOf(xml)
    if (i >= 0) return i
    list.push(xml)
    return list.length - 1
  }

  index(s: Style | undefined): number {
    if (!s) return 0
    const key = JSON.stringify(s)
    const known = this.seen.get(key)
    if (known !== undefined) return known
    const font = this.pool(
      this.fonts,
      `<font>${s.bold ? '<b/>' : ''}${s.italic ? '<i/>' : ''}${s.underline ? '<u/>' : ''}<sz val="${fmt(s.size ?? 11)}"/>${s.color ? `<color rgb="FF${s.color}"/>` : ''}<name val="${esc(s.font ?? 'Calibri')}"/><family val="2"/></font>`,
    )
    const fill = s.fill ? this.pool(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0
    const edge = (name: string, e?: Edge) => (e ? `<${name} style="${e}"><color auto="1"/></${name}>` : `<${name}/>`)
    const b = s.border
    const border = b ? this.pool(this.borders, `<border>${edge('left', b.left)}${edge('right', b.right)}${edge('top', b.top)}${edge('bottom', b.bottom)}<diagonal/></border>`) : 0
    let numFmt = 0
    if (s.numFmt) {
      const id = FORMAT_IDS.get(s.numFmt)
      if (id !== undefined) numFmt = id
      else {
        const at = this.formats.indexOf(s.numFmt)
        numFmt = 164 + (at >= 0 ? at : this.formats.push(s.numFmt) - 1)
      }
    }
    const align = s.align || s.valign || s.wrap ? `<alignment${s.align ? ` horizontal="${s.align}"` : ''}${s.valign ? ` vertical="${s.valign}"` : ''}${s.wrap ? ' wrapText="1"' : ''}/>` : ''
    this.xfs.push(
      `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`,
    )
    this.seen.set(key, this.xfs.length - 1)
    return this.xfs.length - 1
  }

  xml(): string {
    const list = (tag: string, items: string[]) => `<${tag} count="${items.length}">${items.join('')}</${tag}>`
    const fmts = this.formats.length ? `<numFmts count="${this.formats.length}">${this.formats.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : ''
    return `${HEAD}<styleSheet xmlns="${NS}">${fmts}${list('fonts', this.fonts)}${list('fills', this.fills)}${list('borders', this.borders)}<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>${list('cellXfs', this.xfs)}<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  }
}

function cellXml(ref: string, c: Cell, styles: Styles): string {
  const s = styles.index(c.style)
  const attr = `r="${ref}"${s ? ` s="${s}"` : ''}`
  const v = c.value
  if (v === null || v === '') return s ? `<c ${attr}/>` : ''
  if (typeof v === 'number') return Number.isFinite(v) ? `<c ${attr}><v>${v}</v></c>` : `<c ${attr} t="e"><v>#NUM!</v></c>`
  if (typeof v === 'boolean') return `<c ${attr} t="b"><v>${v ? 1 : 0}</v></c>`
  return `<c ${attr} t="inlineStr"><is><t xml:space="preserve">${esc(v.slice(0, MAX_CHARS))}</t></is></c>`
}

function sheetXml(sh: Sheet, styles: Styles): string {
  const rows = sh.rows
  const hiddenCols = new Set(sh.hiddenCols)
  const hiddenRows = new Set(sh.hiddenRows)
  let cols = ''
  for (let i = 0; i < Math.max(sh.colWidths?.length ?? 0, ...hiddenCols, -1) + 1; i++) {
    const w = sh.colWidths?.[i]
    if (w || hiddenCols.has(i)) cols += `<col min="${i + 1}" max="${i + 1}" width="${fmt(w ?? 8.43)}"${w ? ' customWidth="1"' : ''}${hiddenCols.has(i) ? ' hidden="1"' : ''}/>`
  }
  let data = ''
  rows.forEach((row, r) => {
    const cells = row.map((c, i) => (c ? cellXml(`${colName(i)}${r + 1}`, c, styles) : '')).join('')
    const ht = sh.rowHeights?.[r]
    if (cells || ht || hiddenRows.has(r)) data += `<row r="${r + 1}"${ht ? ` ht="${fmt(ht)}" customHeight="1"` : ''}${hiddenRows.has(r) ? ' hidden="1"' : ''}>${cells}</row>`
  })
  const merges = sh.merges?.length
    ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${colName(m.col)}${m.row + 1}:${colName(m.col + m.cols - 1)}${m.row + m.rows}"/>`).join('')}</mergeCells>`
    : ''
  return `${HEAD}<worksheet xmlns="${NS}"><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${data}</sheetData>${merges}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${sh.landscape ? '<pageSetup orientation="landscape"/>' : ''}</worksheet>`
}

/** the file for these sheets; `rows` may have at most 1,048,576 rows and 16,384 columns, which the caller keeps to */
export async function writeXlsx(sheets: Sheet[]): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const names = sheetNames(sheets.map((s) => s.name))
  const styles = new Styles()
  const sheetParts = sheets.map((s) => sheetXml(s, styles))
  const files = [
    { name: '[Content_Types].xml', text: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', text: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `${HEAD}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}"${sheets[i].hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    ...sheetParts.map((text, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text })),
    { name: 'xl/styles.xml', text: styles.xml() }, // after the sheets: it lists the looks they asked for
  ]
  return zipPacked(files.map((f) => ({ name: f.name, bytes: enc.encode(f.text) })))
}
