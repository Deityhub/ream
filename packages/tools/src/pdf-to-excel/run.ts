import { UserError, type RunFn } from '@ream/core'
import { writeXlsx, type Sheet } from '@ream/office-core'
import { findTables, pageChars, type Table } from '@ream/pdf-render'
import { baseName, loadPdf, selectPages } from '../pdf-common.ts'
import { sheetOf } from './sheet.ts'

export type PdfToExcelOptions = {
  /** like "1-3, 5"; empty for every page */
  pages: string
  /** one sheet for each table, or one for each page with its tables stacked */
  layout: 'table' | 'page'
  /** turn text like "1,234.50" or "12%" into numbers */
  numbers: boolean
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const run: RunFn<PdfToExcelOptions> = async (files, o, { progress }) => {
  const f = files[0]
  const doc = await loadPdf(f)
  const count = doc.pages().length
  const chosen = selectPages(o.pages, count)
  const pages = chosen ? [...chosen].sort((a, b) => a - b) : Array.from({ length: count }, (_, i) => i)
  const found: { page: number; tables: Table[] }[] = []
  for (const [n, p] of pages.entries()) {
    progress(n / pages.length)
    const tables = findTables(await pageChars(doc, p))
    if (tables.length) found.push({ page: p + 1, tables })
  }
  const total = found.reduce((n, p) => n + p.tables.length, 0)
  if (!total) {
    throw new UserError(
      'No tables were found. Ream looks for tables drawn with lines, and for text that lines up in columns on at least three rows. Scanned pages are pictures, and reading them needs OCR, which Ream does not have yet.',
    )
  }
  const sheets: Sheet[] = []
  for (const { page, tables } of found) {
    if (o.layout === 'page') sheets.push(sheetOf(`Page ${page}`, tables, o.numbers))
    else tables.forEach((t, i) => sheets.push(sheetOf(tables.length > 1 ? `Page ${page} table ${i + 1}` : `Page ${page}`, [t], o.numbers)))
  }
  progress(1)
  return [{ name: `${baseName(f.name)}.xlsx`, type: XLSX, bytes: await writeXlsx(sheets) }]
}
