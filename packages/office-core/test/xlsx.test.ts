import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { UserError, unzip, zip } from '@ream/core'
import { readXlsx, sheetNames, writeXlsx, type Sheet } from '../src/index.ts'

const sheet: Sheet = {
  name: 'Totals',
  rows: [
    [{ value: 'Item', style: { bold: true, fill: 'DDEEFF', border: { bottom: 'thin' } } }, { value: 'Price', style: { bold: true, align: 'right' } }, { value: 'Date' }],
    [{ value: 'Tea & <coffee>' }, { value: 1234.5, style: { numFmt: '#,##0.00' } }, { value: 45000, style: { numFmt: 'yyyy-mm-dd' } }],
    [{ value: 'Rate' }, { value: 0.256, style: { numFmt: '0.0%' } }, { value: true }],
    [],
    [{ value: 'merged', style: { wrap: true, valign: 'top', italic: true, color: 'CC0000', size: 14, font: 'Arial' } }, null, null],
  ],
  colWidths: [20, 12],
  rowHeights: [undefined, 30],
  merges: [{ row: 4, col: 0, rows: 1, cols: 3 }],
  landscape: true,
}

test('what is written is read back: values, looks, number formats shown as Excel would, widths, merges', async () => {
  const book = await readXlsx(await writeXlsx([sheet, { name: 'Empty', rows: [] }]))
  expect(book.sheets.map((s) => s.name)).toEqual(['Totals', 'Empty'])
  const s = book.sheets[0]
  expect(s.rows[0]![0]).toMatchObject({ value: 'Item', text: 'Item', style: { bold: true, fill: 'DDEEFF', border: { bottom: 'thin' } } })
  expect(s.rows[0]![1]!.style).toMatchObject({ bold: true, align: 'right' })
  expect(s.rows[1]![0]!.value).toBe('Tea & <coffee>')
  expect(s.rows[1]![1]).toMatchObject({ value: 1234.5, text: '1,234.50' })
  expect(s.rows[1]![2]!.text).toBe('2023-03-15')
  expect(s.rows[2]![1]!.text).toBe('25.6%')
  expect(s.rows[2]![2]).toMatchObject({ value: true, text: 'TRUE' })
  expect(s.rows[4]![0]!.style).toMatchObject({ wrap: true, valign: 'top', italic: true, color: 'CC0000', size: 14, font: 'Arial' })
  expect(s.colWidths!.slice(0, 2)).toEqual([20, 12])
  expect(s.rowHeights![1]).toBe(30)
  expect(s.merges).toEqual([{ row: 4, col: 0, rows: 1, cols: 3 }])
  expect(s.landscape).toBe(true)
})

test('sheet names: Excel limits, no duplicates', () => {
  expect(sheetNames(['a/b', 'A/B', 'x'.repeat(40), '', 'Q1: [draft]'])).toEqual(['a b', 'A B 2', 'x'.repeat(31), 'Sheet', 'Q1   draft'])
})

test('reads shared strings with runs, theme colours and tints, formulas, hidden rows and columns', async () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  const files = [
    ['[Content_Types].xml', '<Types/>'],
    ['_rels/.rels', '<Relationships xmlns="x"><Relationship Id="r1" Type="http://x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<workbook xmlns="m" xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/><sheet name="H" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships xmlns="x"><Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://x/worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://x/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://x/sharedStrings" Target="sharedStrings.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', '<sst><si><r><t>Hel</t></r><r><t>lo</t></r></si><si><t>plain</t></si></sst>'],
    ['xl/styles.xml', '<styleSheet><fonts><font><sz val="11"/></font><font><b/><color theme="4"/></font></fonts><fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills><borders><border/></borders><cellXfs><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="9" fontId="1" fillId="1" borderId="0"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><cols><col min="2" max="3" width="9" hidden="1"/></cols><sheetData><row r="2" hidden="1"><c r="B2" t="s" s="1"><v>0</v></c><c r="C2" s="1"><v>0.5</v></c><c r="D2" t="str"><f>A1</f><v>from formula</v></c></row><row r="3"><c r="A3"><v>7</v></c><c r="B3" t="s"><v>1</v></c><c r="C3" s="1"/></row></sheetData></worksheet>'],
    ['xl/worksheets/sheet2.xml', '<worksheet><sheetData/></worksheet>'],
  ] as const
  const book = await readXlsx(zip(files.map(([name, t]) => ({ name, bytes: enc(t) }))))
  const s = book.sheets[0]
  expect(s.rows[1]![1]).toMatchObject({ value: 'Hello', style: { bold: true, fill: 'FFFF00', color: '4472C4' } })
  expect(s.rows[1]![2]).toMatchObject({ value: 0.5, text: '50%' })
  expect(s.rows[1]![3]!.value).toBe('from formula')
  expect(s.rows[2]![0]!.value).toBe(7)
  expect(s.rows[2]![1]!.value).toBe('plain')
  expect(s.rows[2]![2]!.value).toBeNull() // empty but coloured: kept
  expect(s.hiddenRows).toEqual([1])
  expect(s.hiddenCols).toEqual([1, 2])
  expect(book.sheets.map((x) => x.hidden)).toEqual([false, true])
})

test('refuses what is not a workbook, with words a user can act on', async () => {
  await expect(readXlsx(new TextEncoder().encode('just text, nothing zipped here at all, really'))).rejects.toBeInstanceOf(UserError)
  await expect(readXlsx(zip([{ name: 'a.txt', bytes: new Uint8Array(1) }]))).rejects.toThrow(/Excel workbook/)
  expect([...(await unzip(await writeXlsx([sheet]))).keys()]).toContain('xl/styles.xml')
})

// setup.xlsx was made by openpyxl: A5 landscape with grid lines, a print area, a repeated header row, a picture, and a
// second sheet set to fit one page wide
test('page setup, print area, repeated rows and pictures are read', async () => {
  const book = await readXlsx(new Uint8Array(readFileSync(new URL('./fixtures/setup.xlsx', import.meta.url))))
  const [sales, wide] = book.sheets
  expect(sales.page).toMatchObject({ saved: true, paper: [420, 595], landscape: true, gridlines: true, scale: 100, area: { row: 0, col: 0, rows: 41, cols: 4 }, titleRows: [0, 0] })
  expect(sales.page!.margins).toEqual({ left: 54, right: 54, top: 72, bottom: 72 })
  expect(sales.page!.fit).toBeUndefined()
  expect(sales.pictures).toHaveLength(1)
  expect(sales.pictures![0]).toMatchObject({ from: { col: 2, row: 2, dx: 0, dy: 0 }, width: 48, height: 36, type: 'png' })
  expect(sales.rows[1]![1]).toMatchObject({ value: -1, style: { color: 'FF0000' } })
  expect(sales.rows[2]![1]!.style!.color).not.toBe('FF0000')
  expect(wide.page).toMatchObject({ fit: { wide: 1, tall: 0 }, landscape: false })
  expect(wide.page!.paper).toBeUndefined()
})
