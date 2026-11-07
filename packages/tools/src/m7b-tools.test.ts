import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, test } from 'vitest'
import type { FileData } from '@ream/core'
import { decodeJpeg, decodePng, ownCodec, setCodec } from '@ream/image-core'
import { PdfDocument, readOutline, type PdfObj } from '@ream/pdf-core'
import type { PageRaster } from '@ream/pdf-render'
import { readXlsx, writeXlsx, writePptx, parseXml, kids, child, type Sheet, type XmlNode } from '@ream/office-core'
import { unzip } from '@ream/core'
import { extractText, pageChars } from '@ream/pdf-render'
import { assemble, classicPdf } from '../../pdf-core/test/helpers.ts'
import { run as toImage } from './pdf-to-image/run.ts'
import { run as toExcel } from './pdf-to-excel/run.ts'
import { run as excelToPdf } from './excel-to-pdf/run.ts'
import { run as toWord } from './pdf-to-word/run.ts'
import { run as toPowerpoint } from './pdf-to-powerpoint/run.ts'
import { run as powerpointToPdf } from './powerpoint-to-pdf/run.ts'
import { readPptx } from '@ream/office-core'
import { familyOf } from './office-fonts.ts'
import { nodeFonts } from './fonts/node.ts'
import { parseNumber } from './pdf-to-excel/number.ts'
import { officeToPdf } from './office-preview.ts'
import { docxToPdf, run as wordToPdf } from './word-to-pdf/run.ts'
import { PIXEL, inline, makeDocx, noteMark, notesPart, para, part, placed, scramble, withFonts } from '../../office-core/test/docx-helper.ts'
import { makeTtf } from '../../pdf-core/test/ttf-helper.ts'

beforeAll(() => setCodec(ownCodec)) // JPG pages go through the codec; the browser's is checked in the app

const ctx = { progress: () => {} }
const pdf = (n = 3, name = 'doc.pdf'): FileData => ({ name, type: 'application/pdf', bytes: classicPdf(Array.from({ length: n }, (_, i) => `P${i + 1}`)) })

describe('pdf to image', () => {
  // the renderer needs a canvas; a fake gives every page a flat grey whose level is its page number
  const seen: { index: number; width: number }[] = []
  const raster: PageRaster = async (doc, index, widthPx) => {
    seen.push({ index, width: widthPx })
    const { width, height } = doc.pageSize(doc.pages()[index])
    const w = widthPx
    const h = Math.max(1, Math.round((height / width) * widthPx))
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < data.length; i += 4) data.set([40 * (index + 1), 40 * (index + 1), 40 * (index + 1), 255], i)
    return { width: w, height: h, data }
  }
  const o = { pages: '', format: 'png' as const, dpi: 144, quality: 90 }

  test('every page becomes a PNG, named in order, sized by dpi (200 pt at 144 dpi is 400 wide)', async () => {
    seen.length = 0
    const out = await toImage([pdf(3)], o, ctx, raster)
    expect(out.map((f) => f.name)).toEqual(['doc-page-1.png', 'doc-page-2.png', 'doc-page-3.png'])
    expect(seen.map((s) => s.width)).toEqual([400, 400, 400])
    const img = await decodePng(out[1].bytes)
    expect(img.width).toBe(400)
    expect([...img.data.subarray(0, 4)]).toEqual([80, 80, 80, 255])
  })

  test('page numbers are padded to the page count so the files sort', async () => {
    const out = await toImage([pdf(12)], { ...o, pages: '2, 11-12', dpi: 36 }, ctx, raster)
    expect(out.map((f) => f.name)).toEqual(['doc-page-02.png', 'doc-page-11.png', 'doc-page-12.png'])
  })

  test('JPG output decodes and keeps the colours roughly', async () => {
    const out = await toImage([pdf(1)], { ...o, format: 'jpg', dpi: 36 }, ctx, raster)
    expect(out[0].type).toBe('image/jpeg')
    const img = decodeJpeg(out[0].bytes)
    expect(Math.abs(img.data[0] - 40)).toBeLessThan(6)
  })

  test('a page too big at the chosen dpi is refused before anything is drawn', async () => {
    seen.length = 0
    await expect(toImage([pdf(2)], { ...o, dpi: 600, pages: '' }, ctx, raster)).resolves.toHaveLength(2)
    seen.length = 0
    const huge: FileData = {
      name: 'big.pdf',
      type: 'application/pdf',
      bytes: assemble([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 14400 14400] >>']]).bytes,
    }
    await expect(toImage([huge], { ...o, dpi: 600 }, ctx, raster)).rejects.toThrow(/megapixels/)
    expect(seen).toHaveLength(0)
  })

  test('a page range outside the document says so', async () => {
    await expect(toImage([pdf(2)], { ...o, pages: '9' }, ctx, raster)).rejects.toThrow(/page/i)
  })
})

describe('pdf to excel', () => {
  const FONT = '/Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >>'
  const t = (x: number, y: number, str: string) => `BT /F1 10 Tf ${x} ${y} Td (${str}) Tj ET\n`
  const line = (x0: number, y0: number, x1: number, y1: number) => `0.5 w ${x0} ${y0} m ${x1} ${y1} l S\n`
  /** a page with a ruled 3 x 2 table: header, then a text, number row */
  const pdfWith = (pages: string[]): FileData => {
    const objs: [number, string][] = [[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`]]
    pages.forEach((c, i) => {
      objs.push([3 + 2 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << ${FONT} >> /Contents ${4 + 2 * i} 0 R >>`])
      objs.push([4 + 2 * i, `<< /Length ${c.length} >>\nstream\n${c}\nendstream`])
    })
    return { name: 'in.pdf', type: 'application/pdf', bytes: assemble(objs).bytes }
  }
  const table = (rows: string[][]) => {
    let c = ''
    const ys = rows.map((_, i) => 250 - i * 20)
    for (const y of [...ys, ys[ys.length - 1] - 20]) c += line(50, y, 190, y)
    for (const x of [50, 120, 190]) c += line(x, 250, x, ys[ys.length - 1] - 20)
    rows.forEach((r, i) => r.forEach((v, j) => (c += t(55 + j * 70, ys[i] - 14, v))))
    return c
  }
  const o = { pages: '', layout: 'table' as const, numbers: true }

  test('number parsing keeps codes and ambiguous formats as text', () => {
    expect(parseNumber('1,234.50')).toEqual({ value: 1234.5, numFmt: '#,##0.00' })
    expect(parseNumber('(45.20)')).toEqual({ value: -45.2, numFmt: '0.00' })
    expect(parseNumber('-12')).toEqual({ value: -12, numFmt: undefined })
    expect(parseNumber('$1,000')).toEqual({ value: 1000, numFmt: '"$"#,##0' })
    expect(parseNumber('12.5%')).toEqual({ value: 0.125, numFmt: '0.0%' })
    expect(parseNumber('2024')).toEqual({ value: 2024, numFmt: undefined })
    for (const s of ['007', '1.234,56', '12 kg', '', 'abc', '555123456789', '1,23', '0123.4x']) expect(parseNumber(s), s).toBeNull()
  })

  test('a ruled table becomes a sheet with real numbers, borders and the page order kept', async () => {
    const out = await toExcel([pdfWith([table([['Item', 'Price'], ['Tea', '1,234.50'], ['Milk', '99']])])], o, ctx)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('in.xlsx')
    const book = await readXlsx(out[0].bytes)
    expect(book.sheets.map((s) => s.name)).toEqual(['Page 1'])
    const rows = book.sheets[0].rows
    expect(rows[0]!.map((c) => c?.value)).toEqual(['Item', 'Price'])
    expect(rows[1]![1]).toMatchObject({ value: 1234.5, text: '1,234.50', style: { border: { top: 'thin' } } })
    expect(rows[2]![1]!.value).toBe(99)
    expect(rows[1]![0]!.value).toBe('Tea')
  })

  test('the look comes along: fills under cells, each side its own line weight, page widths and heights, fonts', async () => {
    // a blue header band, and a heavier line under the header
    const look = `0.2 0.4 0.6 rg 50 230 140 20 re f 0 g\n` + table([['Item', 'Price'], ['Tea', '5']]) + `2 w 50 230 m 190 230 l S\n`
    const sh = (await readXlsx((await toExcel([pdfWith([look])], o, ctx))[0].bytes)).sheets[0]
    const head = sh.rows[0]![0]!.style!
    expect(head.fill).toBe('336699')
    expect(head.border).toEqual({ top: 'thin', right: 'thin', bottom: 'medium', left: 'thin' })
    expect(sh.rows[1]![0]!.style!.fill).toBeUndefined()
    expect(sh.rows[1]![0]!.style!.border!.top).toBe('medium')
    expect(head).toMatchObject({ font: 'Helvetica', size: 10 })
    // 70 pt columns are 12.6 characters wide; 20 pt rows
    expect(sh.colWidths![0]).toBeCloseTo(12.62, 1)
    expect(sh.rowHeights![0]).toBe(20)
  })

  test('numbers stay text when asked, and layouts differ in sheet count', async () => {
    const two = pdfWith([table([['A', 'B'], ['x', '1'], ['y', '2']]), table([['C', 'D'], ['z', '3'], ['w', '4']])])
    const asText = await readXlsx((await toExcel([two], { ...o, numbers: false }, ctx))[0].bytes)
    expect(asText.sheets[0].rows[1]![1]!.value).toBe('1')
    expect((await readXlsx((await toExcel([two], o, ctx))[0].bytes)).sheets).toHaveLength(2)
    expect((await readXlsx((await toExcel([two], { ...o, layout: 'page', pages: '2' }, ctx))[0].bytes)).sheets.map((s) => s.name)).toEqual(['Page 2'])
  })

  test('a document with no tables says so', async () => {
    await expect(toExcel([pdf(2)], o, ctx)).rejects.toThrow(/No tables were found/)
  })
})

describe('excel to pdf', () => {
  const xlsx = async (sheets: Sheet[], name = 'book.xlsx'): Promise<FileData> => ({ name, type: '', bytes: await writeXlsx(sheets) })
  const o = { setup: 'choose' as const, paper: 'a4' as const, orientation: 'auto' as const, fit: 'width' as const, gridlines: false, localFonts: [] }
  const text = async (f: FileData, page = 0) => {
    const doc = await PdfDocument.load(f.bytes)
    return (await extractText(doc, [page], { markdown: false }))[0]
  }
  const grid = (n: number, cols = 3): Sheet['rows'] => Array.from({ length: n }, (_, r) => Array.from({ length: cols }, (_, c) => ({ value: `r${r}c${c}` })))

  test('cells keep their text, numbers show as formatted, a title row and the page size come out right', async () => {
    const [out] = await excelToPdf([await xlsx([{ name: 'S', rows: [[{ value: 'Item', style: { bold: true } }, { value: 'Price' }], [{ value: 'Tea' }, { value: 1234.5, style: { numFmt: '#,##0.00' } }]] }])], o, ctx, nodeFonts)
    expect(out.name).toBe('book.pdf')
    const doc = await PdfDocument.load(out.bytes)
    expect(doc.pages()).toHaveLength(1)
    expect(doc.pageSize(doc.pages()[0])).toEqual({ width: 595, height: 842 })
    expect((await text(out)).replace(/ +/g, ' ')).toBe('Item Price\nTea 1,234.50')
  })

  test('long sheets continue on more pages; a wide one is shrunk to one page or split across', async () => {
    const tall = await xlsx([{ name: 'T', rows: grid(120) }])
    expect((await PdfDocument.load((await excelToPdf([tall], o, ctx, nodeFonts))[0].bytes)).pages().length).toBeGreaterThan(2)
    const wide = await xlsx([{ name: 'W', rows: grid(5, 30), colWidths: Array(30).fill(12) }])
    const fit = await PdfDocument.load((await excelToPdf([wide], o, ctx, nodeFonts))[0].bytes)
    expect(fit.pages()).toHaveLength(1)
    expect(fit.pageSize(fit.pages()[0]).width).toBeGreaterThan(fit.pageSize(fit.pages()[0]).height) // automatic direction chose landscape
    const split = await PdfDocument.load((await excelToPdf([wide], { ...o, fit: 'none' }, ctx, nodeFonts))[0].bytes)
    expect(split.pages().length).toBeGreaterThan(2)
  })

  test('hidden sheets, rows and columns are left out; merged and wrapped cells are drawn once', async () => {
    const rows = [[{ value: 'keep' }, { value: 'hidden col' }, { value: 'x' }], [{ value: 'hidden row' }], [{ value: 'a long wrapped sentence that needs several lines', style: { wrap: true } }]]
    const f = await xlsx([{ name: 'A', rows, hiddenCols: [1], hiddenRows: [1], colWidths: [10] }, { name: 'B', rows: grid(2), hidden: true }, { name: 'M', rows: [[{ value: 'wide merge' }, null, null]], merges: [{ row: 0, col: 0, rows: 1, cols: 3 }] }])
    const out = await excelToPdf([f], o, ctx, nodeFonts)
    const pages = (await PdfDocument.load(out[0].bytes)).pages().length
    expect(pages).toBe(2) // sheet B is hidden
    const t = (await text(out[0], 0) + ' ' + (await text(out[0], 1))).replace(/\s+/g, ' ')
    expect(t).toContain('keep x')
    expect(t).not.toContain('hidden col')
    expect(t).not.toContain('hidden row')
    expect(t).toContain('long wrapped')
    expect((t.match(/wide merge/g) ?? []).length).toBe(1)
  })

  test('letters no font has show as ?; an empty or damaged workbook gives a clear error', async () => {
    // Cyrillic comes from the look-alike's Cyrillic part; a script none of the bundled fonts has becomes ?
    const [out] = await excelToPdf([await xlsx([{ name: 'S', rows: [[{ value: 'aЖb中' }]] }])], o, ctx, nodeFonts)
    expect(await text(out)).toBe('aЖb?')
    await expect(excelToPdf([await xlsx([{ name: 'S', rows: [] }])], o, ctx, nodeFonts)).rejects.toThrow(/nothing to print/)
    await expect(excelToPdf([{ name: 'bad.xlsx', type: '', bytes: new TextEncoder().encode('not a zip file at all, nothing to see here') }], o, ctx, nodeFonts)).rejects.toThrow(/bad.xlsx/)
  })

  test("the workbook's own page setup: paper, direction, repeated rows, print area, fit to width, a picture on its cell", async () => {
    // setup.xlsx (openpyxl): sheet 1 A5 landscape, header row repeated, print area A1:D41, a picture at C3;
    // sheet 2 has no paper size (so the panel's A4 is used) and is set to fit one page wide
    const f: FileData = { name: 'setup.xlsx', type: '', bytes: new Uint8Array(readFileSync(new URL('../../office-core/test/fixtures/setup.xlsx', import.meta.url))) }
    const [out] = await excelToPdf([f], { ...o, setup: 'file' }, ctx, nodeFonts)
    const doc = await PdfDocument.load(out.bytes)
    const sizes = doc.pages().map((p) => doc.pageSize(p))
    expect(sizes.slice(0, -1).every((s) => s.width === 595 && s.height === 420)).toBe(true)
    expect(sizes.length).toBe(4) // 40 body rows at 17 a page, then the wide sheet on one page
    expect(sizes[sizes.length - 1]).toEqual({ width: 595, height: 842 })
    for (const i of [0, 1, 2]) expect((await text(out, i)).split('\n')[0]).toMatch(/^Region\s+Change$/)
    expect(await text(out, 3)).toContain('Column 40')
    expect(new TextDecoder('latin1').decode(out.bytes).match(/\/Subtype \/Image/g)).toHaveLength(1)
    // chosen settings replace the file's paper (Automatic direction still follows the sheet's landscape)
    const chosen = await PdfDocument.load((await excelToPdf([f], o, ctx, nodeFonts))[0].bytes)
    expect(chosen.pageSize(chosen.pages()[0])).toEqual({ width: 842, height: 595 })
  })

  test('a merged range declared as big as the whole sheet is cut to the cells that are there', async () => {
    const f = await xlsx([{ name: 'S', rows: [[{ value: 'only cell' }]], merges: [{ row: 0, col: 0, rows: 1_048_576, cols: 16_384 }] }])
    const started = Date.now()
    const [out] = await excelToPdf([f], o, ctx, nodeFonts)
    expect(Date.now() - started).toBeLessThan(3000)
    expect(await text(out)).toContain('only cell')
  })

  test('font names map to the three standard families', () => {
    expect(['Calibri', 'Arial', 'Segoe UI', 'Century Gothic', 'Liberation Sans', undefined].map(familyOf)).toEqual(['sans', 'sans', 'sans', 'sans', 'sans', 'sans'])
    expect(['Times New Roman', 'Georgia', 'Cambria'].map(familyOf)).toEqual(['serif', 'serif', 'serif'])
    expect(['Courier New', 'Consolas', 'Menlo'].map(familyOf)).toEqual(['mono', 'mono', 'mono'])
  })
})

describe('pdf to word', () => {
  const FONT = '/Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >>'
  const t = (x: number, y: number, str: string, font = 'F1', size = 10) => `BT /${font} ${size} Tf ${x} ${y} Td (${str}) Tj ET\n`
  const line = (x0: number, y0: number, x1: number, y1: number) => `0.5 w ${x0} ${y0} m ${x1} ${y1} l S\n`
  const pdfOf = (content: string): FileData => ({
    name: 'in.pdf',
    type: 'application/pdf',
    bytes: assemble([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << ${FONT} >> /Contents 4 0 R >>`], [4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`]]).bytes,
  })
  const page = t(40, 350, 'A Heading', 'F2', 20) + t(40, 320, 'First paragraph line one') + t(40, 308, 'and line two of it.') +
    t(40, 280, 'Second paragraph') +
    [0, 1, 2].map((i) => line(40, 240 - i * 20, 190, 240 - i * 20)).join('') + line(40, 240, 40, 200) + line(115, 240, 115, 200) + line(190, 240, 190, 200) + line(40, 200, 190, 200) +
    t(45, 226, 'Cell A') + t(120, 226, 'Cell B') + t(45, 206, 'Cell C') + t(120, 206, 'Cell D') + t(40, 160, 'After the table')
  const ctxo = { pages: '', mode: 'flow' as const, dpi: 150 }
  const document = async (f: FileData) => parseXml(new TextDecoder().decode((await unzip(f.bytes)).get('word/document.xml')!))
  const paras = (n: XmlNode): string[] => kids(child(n, 'body'), 'p').map((p) => kids(p, 'r').map((r) => kids(r, 't').map((x) => x.text).join('')).join(''))

  test('headings, paragraphs and a table come out as Word content in reading order', async () => {
    const [out] = await toWord([pdfOf(page)], ctxo, ctx)
    expect(out.name).toBe('in.docx')
    const body = child(await document(out), 'body')!
    const order = body.children.map((c) => c.name)
    expect(order.slice(0, 5)).toEqual(['p', 'p', 'p', 'tbl', 'p']) // heading, two paragraphs, table, its spacer
    const ps = paras(await document(out)).filter(Boolean)
    expect(ps).toEqual(['A Heading', 'First paragraph line one and line two of it.', 'Second paragraph', 'After the table'])
    const tbl = kids(body, 'tbl')[0]
    expect(kids(tbl, 'tr').map((r) => kids(r, 'tc').map((c) => kids(c, 'p').map((p) => kids(p, 'r').map((r) => kids(r, 't')[0]?.text).join('')).join(''))) ).toEqual([['Cell A', 'Cell B'], ['Cell C', 'Cell D']])
    const sect = child(body, 'sectPr')!
    expect(child(sect, 'pgSz')!.attrs).toMatchObject({ w: '6000', h: '8000' }) // 300 x 400 points in twips
    expect(body.children.some((c) => c.name === 'p' && child(child(c, 'pPr'), 'pStyle')?.attrs.val === 'Heading1')).toBe(true)
  })

  test('page pictures: one section per page holding a picture the size of the page, no text', async () => {
    const raster: PageRaster = async (_doc, _i, w) => ({ width: w, height: w, data: new Uint8ClampedArray(w * w * 4).fill(255) })
    const [out] = await toWord([pdf(2)], { ...ctxo, mode: 'picture', dpi: 100 }, ctx, raster)
    const parts = await unzip(out.bytes)
    expect([...parts.keys()].filter((k) => k.startsWith('word/media/'))).toHaveLength(2)
    const d = await document(out)
    expect(kids(child(d, 'body'), 'p').length).toBeGreaterThanOrEqual(2)
    expect(paras(d).join('')).toBe('')
  })

  test('same layout: the page design behind, every paragraph and cell in a text box at its place, in reading order', async () => {
    const grey: PageRaster = async (_d, _i, w) => ({ width: w, height: w, data: new Uint8ClampedArray(w * w * 4).fill(180) })
    const [out] = await toWord([pdfOf(page)], { ...ctxo, mode: 'layout' }, ctx, grey)
    const xml = new TextDecoder().decode((await unzip(out.bytes)).get('word/document.xml')!)
    // text boxes placed on the page: the heading's at x 40 pt = 508000 EMU
    const boxes = [...xml.matchAll(/<wp:positionH relativeFrom="page"><wp:posOffset>(\d+)<\/wp:posOffset>/g)].map((m) => Number(m[1]))
    expect(boxes.length).toBe(9) // the design picture, heading, 3 paragraphs, 4 cells
    expect(boxes[1]).toBe(508000)
    const texts = [...xml.matchAll(/<w:txbxContent>(.*?)<\/w:txbxContent>/g)].map((m) => [...m[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''))
    expect(texts).toEqual(['A Heading', 'First paragraph line one and line two of it.', 'Second paragraph', 'After the table', 'Cell A', 'Cell B', 'Cell C', 'Cell D'])
    parseXml(xml) // well formed
    expect([...(await unzip(out.bytes)).keys()].filter((k) => k.startsWith('word/media/'))).toHaveLength(1)
  })

  test('a page with no text or pictures says what to do', async () => {
    await expect(toWord([pdfOf('')], ctxo, ctx)).rejects.toThrow(/Page pictures/)
  })
})

describe('pdf to powerpoint and back', () => {
  const FONT = '/Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >>'
  const t = (x: number, y: number, str: string, font = 'F1', size = 12) => `BT /${font} ${size} Tf ${x} ${y} Td (${str}) Tj ET\n`
  const line = (x0: number, y0: number, x1: number, y1: number) => `0.5 w ${x0} ${y0} m ${x1} ${y1} l S\n`
  const pdfOf = (content: string): FileData => ({
    name: 'in.pdf',
    type: 'application/pdf',
    bytes: assemble([[1, '<< /Type /Catalog /Pages 2 0 R >>'], [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'], [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << ${FONT} >> /Contents 4 0 R >>`], [4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`]]).bytes,
  })
  const page = t(40, 250, 'Slide title', 'F2', 24) + t(40, 215, 'A line of body text') + t(40, 200, 'and a second line.') +
    [0, 1].map((i) => line(40, 150 - i * 20, 200, 150 - i * 20)).join('') + line(40, 110, 200, 110) + line(40, 150, 40, 110) + line(120, 150, 120, 110) + line(200, 150, 200, 110) +
    t(45, 136, 'R1C1') + t(125, 136, 'R1C2') + t(45, 116, 'R2C1') + t(125, 116, 'R2C2')
  const base = { pages: '', mode: 'editable' as const, dpi: 100 }
  const textOf = async (f: FileData) => (await extractText(await PdfDocument.load(f.bytes), [0], { markdown: false }))[0]

  // a fake page drawing: grey where the page has design, white when asked for a blank one
  const design = (fill: number): PageRaster => async (_d, _i, w) => ({ width: w, height: Math.round(w * 0.75), data: new Uint8ClampedArray(w * Math.round(w * 0.75) * 4).fill(fill) })

  test('font names survive the round trip: a stand-in font keeps the family the deck asked for', async () => {
    const run = (text: string, font: string) => ({ runs: [{ text, font, size: 24 }] })
    const deck = await writePptx({ width: 720, height: 405, slides: [{ shapes: [{ kind: 'text', x: 40, y: 40, w: 600, h: 200, paragraphs: [run('Set in a font nobody has', 'Gill Sans Nova Light'), run('Set in Calibri', 'Calibri')] }] }] })
    const [pdf] = await powerpointToPdf([{ name: 'd.pptx', type: '', bytes: deck }], { hidden: false, localFonts: [] }, ctx, nodeFonts)
    // both are drawn with the bundled Carlito, but each keeps its own name
    expect(new TextDecoder('latin1').decode(pdf.bytes)).toMatch(/Carlito/)
    const [back] = await toPowerpoint([pdf], base, ctx, design(255))
    const fonts = (await readPptx(back.bytes)).slides[0].shapes.flatMap((x) => (x.kind === 'text' ? x.paragraphs.flatMap((p) => p.runs.filter((r) => r.text.trim()).map((r) => `${r.text.trim()}: ${r.font}`)) : []))
    expect(fonts).toEqual(['Set in a font nobody has: Gill Sans Nova Light', 'Set in Calibri: Calibri'])
  })

  test('editable slides: the page size, the design behind, text boxes where the text was, lines kept, table cells apart', async () => {
    const [out] = await toPowerpoint([pdfOf(page)], base, ctx, design(200))
    expect(out.name).toBe('in.pptx')
    const deck = await readPptx(out.bytes)
    expect([deck.width, deck.height]).toEqual([400, 300])
    const [bg, ...shapes] = deck.slides[0].shapes
    expect(bg).toMatchObject({ kind: 'pic', x: 0, y: 0, w: 400, h: 300 })
    const texts = shapes.map((x) => (x.kind === 'text' ? x.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('/') : ''))
    // the paragraph's lines stay the page's lines; a ruled line between table rows keeps the cells apart
    expect(texts).toEqual(['Slide title', 'A line of body text\nand a second line.', 'R1C1', 'R1C2', 'R2C1', 'R2C2'])
    expect(shapes.every((x) => x.kind !== 'text' || x.wrap === false)).toBe(true)
    expect(shapes[0]).toMatchObject({ x: 40 })
    expect(shapes[0].kind === 'text' && shapes[0].paragraphs[0].runs[0]).toMatchObject({ size: 24, bold: true })
    // a blank page has no design picture
    const plain = await readPptx((await toPowerpoint([pdfOf(page)], base, ctx, design(255)))[0].bytes)
    expect(plain.slides[0].shapes[0].kind).toBe('text')
  })

  test('page pictures: a picture of the page with its text kept behind it', async () => {
    const raster: PageRaster = async (_d, _i, w) => ({ width: w, height: Math.round(w * 0.75), data: new Uint8ClampedArray(w * Math.round(w * 0.75) * 4).fill(255) })
    const [out] = await toPowerpoint([pdfOf(page)], { ...base, mode: 'picture' }, ctx, raster)
    const deck = await readPptx(out.bytes)
    const shapes = deck.slides[0].shapes
    const pic = shapes[shapes.length - 1] // last: on top of the text
    expect(pic).toMatchObject({ kind: 'pic', x: 0, y: 0, w: 400, h: 300 })
    expect(shapes.slice(0, -1).some((x) => x.kind === 'text' && x.paragraphs[0].runs.some((r) => r.text.includes('Slide title')))).toBe(true)
  })

  test('PDF to slides to PDF keeps the words and their order', async () => {
    const [pptx] = await toPowerpoint([pdfOf(page)], base, ctx, design(255))
    const [back] = await powerpointToPdf([{ name: 'in.pptx', type: '', bytes: pptx.bytes }], { hidden: false, localFonts: [] }, ctx, nodeFonts)
    const doc = await PdfDocument.load(back.bytes)
    expect(doc.pageSize(doc.pages()[0])).toEqual({ width: 400, height: 300 })
    const text = (await textOf(back)).replace(/\s+/g, ' ')
    expect(text).toContain('Slide title')
    expect(text.indexOf('Slide title')).toBeLessThan(text.indexOf('A line of body text'))
    expect(text.indexOf('A line of body text')).toBeLessThan(text.indexOf('R1C1'))
    expect(text).toContain('R2C2')
  })

  test('a deck made by another program: one page per slide at the slide size, text from placeholders and a table, pictures and shapes drawn', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../office-core/test/fixtures/deck.pptx', import.meta.url)))
    const [out] = await powerpointToPdf([{ name: 'deck.pptx', type: '', bytes }], { hidden: false, localFonts: [] }, ctx, nodeFonts)
    expect(out.name).toBe('deck.pdf')
    const doc = await PdfDocument.load(out.bytes)
    expect(doc.pages()).toHaveLength(3)
    expect(doc.pageSize(doc.pages()[0])).toEqual({ width: 720, height: 540 })
    const texts = await extractText(doc, [0, 1, 2], { markdown: false })
    expect(texts[0]).toContain('Quarterly review')
    expect(texts[1]).toContain('Hiring plan on track with a very long line')
    expect(texts[1].split('\n').length).toBeGreaterThan(4) // the long bullet wrapped onto a second line
    expect(texts[2]).toContain('R2C2')
    expect(texts[2]).toContain('Free text box')
  })

  test('hidden slides are left out unless asked for; other files are refused', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../office-core/test/fixtures/deck.pptx', import.meta.url)))
    const hide = (b: Uint8Array) => b // the fixture has none hidden: the option must at least not change it
    const [a] = await powerpointToPdf([{ name: 'd.pptx', type: '', bytes: hide(bytes) }], { hidden: true, localFonts: [] }, ctx, nodeFonts)
    expect((await PdfDocument.load(a.bytes)).pages()).toHaveLength(3)
    await expect(powerpointToPdf([{ name: 'bad.pptx', type: '', bytes: new TextEncoder().encode('not a presentation at all, not at all at all') }], { hidden: false, localFonts: [] }, ctx, nodeFonts)).rejects.toThrow(/bad.pptx/)
  })

  test('charts are drawn from their values: title, categories, legend and axis numbers, not a marked gap', async () => {
    const fx = (n: string): FileData => ({ name: n, type: '', bytes: new Uint8Array(readFileSync(new URL(`../../office-core/test/fixtures/${n}`, import.meta.url))) })
    const [deck] = await powerpointToPdf([fx('charts.pptx')], { hidden: false, localFonts: [] }, ctx, nodeFonts)
    const slide = (await textOf(deck)).replace(/\s+/g, ' ')
    for (const w of ['Sales by region', 'North', 'South', 'East', '2024', '2025', '300']) expect(slide).toContain(w)
    expect(slide).not.toContain('not shown')
    const [sheet] = await excelToPdf([fx('charts.xlsx')], { setup: 'file', paper: 'a4', orientation: 'auto', fit: 'width', gridlines: false, localFonts: [] }, ctx, nodeFonts)
    const page = (await textOf(sheet)).replace(/\s+/g, ' ')
    for (const w of ['Traffic', 'Visitors', 'Jan', 'Mar']) expect(page).toContain(w)
  })
})

describe('office previews', () => {
  const fx = (n: string): FileData => ({ name: n, type: '', bytes: new Uint8Array(readFileSync(new URL(`../../office-core/test/fixtures/${n}`, import.meta.url))) })
  const pageText = async (bytes: Uint8Array, page: number) => (await extractText(await PdfDocument.load(bytes), [page], { markdown: false }))[0].replace(/\s+/g, ' ')

  test('a Word document is laid out on its pages: the page break starts page 2, text in order, a picture drawn', async () => {
    const pdf = await docxToPdf(fx('report.docx').bytes, [], nodeFonts)
    const doc = await PdfDocument.load(pdf)
    expect(doc.pages()).toHaveLength(2)
    expect(doc.pageSize(doc.pages()[0])).toEqual({ width: 612, height: 792 })
    const one = await pageText(pdf, 0)
    expect(one.indexOf('Annual report')).toBeLessThan(one.indexOf('bold red'))
    expect(one).toContain('Step two')
    expect(one).toContain('4.50')
    expect(await pageText(pdf, 1)).toContain('Second page Closing words.')
    expect(new TextDecoder('latin1').decode(pdf).match(/\/Subtype \/Image/g)).toHaveLength(1)
  })

  test('decks and workbooks preview through their converters', async () => {
    expect((await PdfDocument.load(await officeToPdf(fx('charts.pptx'), 'pptx', nodeFonts))).pages()).toHaveLength(2)
    expect(await pageText(await officeToPdf(fx('charts.xlsx'), 'xlsx', nodeFonts), 0)).toContain('Traffic')
  })
})

describe('word to pdf', () => {
  const fx = (n: string): FileData => ({ name: n, type: '', bytes: new Uint8Array(readFileSync(new URL(`../../office-core/test/fixtures/${n}`, import.meta.url))) })
  const pageText = async (bytes: Uint8Array, page: number) => (await extractText(await PdfDocument.load(bytes), [page], { markdown: false }))[0].replace(/\s+/g, ' ')
  const footerStyle = '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr></w:style>'
  const pg = '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>'
  const field = (code: string, shown: string) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${shown}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
  const pdfOf = async (docx: Promise<Uint8Array>) => docxToPdf(await docx, [], nodeFonts)

  test('headers and footers repeat with their own page numbers; the first page can differ; a footer\'s tabs put its text at the stops', async () => {
    const pdf = await pdfOf(
      makeDocx({
        styles: footerStyle,
        rels: [['h', 'header', 'h.xml'], ['f', 'footer', 'f.xml'], ['h1', 'header', 'h1.xml'], ['f1', 'footer', 'f1.xml']],
        parts: {
          'word/h.xml': part('hdr', para('Running head')),
          'word/h1.xml': part('hdr', para('Cover')),
          'word/f1.xml': part('ftr', para('Cover footer')),
          'word/f.xml': part('ftr', '<w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t>Left</w:t></w:r><w:r><w:tab/></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">Page </w:t></w:r>' + field('PAGE', '1') + '<w:r><w:t xml:space="preserve"> of </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>'),
        },
        body: para('One') + para('Two', '<w:pageBreakBefore/>') + `<w:sectPr><w:headerReference w:type="default" r:id="h"/><w:headerReference w:type="first" r:id="h1"/><w:footerReference w:type="default" r:id="f"/><w:footerReference w:type="first" r:id="f1"/><w:titlePg/>${pg}</w:sectPr>`,
      }),
    )
    const doc = await PdfDocument.load(pdf)
    expect(doc.pages()).toHaveLength(2)
    const [one, two] = [await pageText(pdf, 0), await pageText(pdf, 1)]
    expect(one).toContain('Cover')
    expect(one).toContain('Cover footer')
    expect(one).not.toContain('Running head')
    expect(two).toContain('Running head')
    expect(two).toContain('Left')
    expect(two).toContain('Page 2 of 2')
    expect(two).not.toContain('Cover')
    // the footer is at the bottom (these y count from the top), its right part ends at the right margin (612 - 72) and its left part starts at the left one
    const { chars } = await pageChars(doc, 1)
    const text = chars.map((c) => c.text).join('')
    const right = chars[text.indexOf('Page 2 of 2') + 10]
    const left = chars[text.indexOf('Left')]
    expect(right.x1).toBeGreaterThan(538)
    expect(right.x1).toBeLessThan(541)
    expect(left.x0).toBeCloseTo(72, 0)
    expect(right.y1).toBeGreaterThan(792 - 72)
    expect(chars[text.indexOf('Running')].y1).toBeLessThan(72)
  })

  test('a header taller than the top margin pushes the body down', async () => {
    const body = (header: boolean) => makeDocx({ rels: header ? [['h', 'header', 'h.xml']] : [], parts: header ? { 'word/h.xml': part('hdr', '<w:p><w:r><w:rPr><w:sz w:val="120"/></w:rPr><w:t>Big</w:t></w:r></w:p>') } : {}, body: para('Body') + `<w:sectPr>${header ? '<w:headerReference w:type="default" r:id="h"/>' : ''}${pg}</w:sectPr>` })
    const top = async (header: boolean) => {
      const { chars } = await pageChars(await PdfDocument.load(await pdfOf(body(header))), 0)
      return chars.find((c) => c.text === 'B' && c.size < 20)!.y1
    }
    // the header (36 pt from the edge, a 60 pt line) ends below the 72 pt margin
    expect(await top(false)).toBeLessThan(90)
    expect(await top(true)).toBeGreaterThan(115)
  })

  // exact 12 pt lines, 54 to a page (648 pt between the margins); `lines` makes a paragraph of that many lines
  const lines = (id: string, n: number, props = '') => `<w:p><w:pPr><w:spacing w:line="240" w:lineRule="exact"/>${props}</w:pPr><w:r>${Array.from({ length: n }, (_, i) => `<w:t>${id}${i + 1}</w:t>`).join('<w:br/>')}</w:r></w:p>`
  const filler = (n: number) => Array.from({ length: n }, (_, i) => lines(`F${i + 1}x`, 1)).join('')
  const split = async (fill: number, tail: string) => {
    const pdf = await pdfOf(makeDocx({ body: filler(fill) + tail + `<w:sectPr>${pg}</w:sectPr>` }))
    return [await pageText(pdf, 0), await pageText(pdf, 1)]
  }

  test('a heading with "keep with next" never ends a page alone; a paragraph is not split to leave one line on either side', async () => {
    const heading = (keep: boolean) => lines('Head', 1, keep ? '<w:keepNext/>' : '') + lines('Body', 3)
    // 52 lines used, room for 2: the heading would fit, but not with two lines of what follows
    const [kept, keptNext] = await split(52, heading(true))
    expect(kept).not.toContain('Head1')
    expect(keptNext).toContain('Head1 Body1 Body2 Body3')
    const [loose] = await split(52, heading(false))
    expect(loose).toContain('Head1')
    expect(loose).not.toContain('Body1') // its first line alone would be an orphan, so all three go to the next page
    // widows: 3 lines, room for 2: the last line can't stand alone, so none stay
    const [w1, w2] = await split(52, lines('W', 3))
    expect(w1).not.toContain('W1')
    expect(w2).toContain('W1 W2 W3')
    // with widow control off it splits after the second line
    const [o1, o2] = await split(52, lines('W', 3, '<w:widowControl w:val="0"/>'))
    expect(o1).toContain('W2')
    expect(o2).toContain('W3')
    expect(o2).not.toContain('W2')
  })

  test('"keep lines together" moves a whole paragraph to the next page', async () => {
    const [free1, free2] = await split(50, lines('K', 5))
    expect(free1).toContain('K3') // room for 4 lines, the fifth can't be alone: 3 stay
    expect(free2).toContain('K4 K5')
    const [kept1, kept2] = await split(50, lines('K', 5, '<w:keepLines/>'))
    expect(kept1).not.toContain('K1')
    expect(kept2).toContain('K1 K2 K3 K4 K5')
    // a heading moved this way is bookmarked on the page it is drawn on
    const pdf = await pdfOf(makeDocx({ body: filler(50) + lines('K', 5, '<w:keepLines/><w:outlineLvl w:val="0"/>') + `<w:sectPr>${pg}</w:sectPr>` }))
    expect(readOutline(await PdfDocument.load(pdf)).map((m) => [m.title, m.page])).toEqual([['K1 K2 K3 K4 K5', 1]])
  })

  test('links are clickable (web and mail only), headings are nested bookmarks', async () => {
    const styles = ['1', '2'].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/></w:style>`).join('')
    const pdf = await pdfOf(
      makeDocx({
        styles,
        rels: [['a', 'hyperlink', 'https://example.com/a', true], ['m', 'hyperlink', 'mailto:me@example.com', true], ['j', 'hyperlink', 'javascript:alert(1)', true]],
        body:
          para('Intro', '<w:pStyle w:val="Heading1"/>') +
          '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r><w:hyperlink r:id="a"><w:r><w:t>the site</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> or </w:t></w:r><w:hyperlink r:id="m"><w:r><w:t>mail</w:t></w:r></w:hyperlink><w:hyperlink r:id="j"><w:r><w:t>bad</w:t></w:r></w:hyperlink></w:p>' +
          para('Detail', '<w:pStyle w:val="Heading2"/>') +
          para('Page two', '<w:pStyle w:val="Heading1"/><w:pageBreakBefore/>') +
          `<w:sectPr>${pg}</w:sectPr>`,
      }),
    )
    const doc = await PdfDocument.load(pdf)
    const annots = (doc.resolve(doc.pages()[0].dict.get('Annots')) as unknown[]).map((r) => doc.resolve(r as never) as Map<string, unknown>)
    expect(annots).toHaveLength(2)
    const uris = annots.map((a) => new TextDecoder().decode(((doc.resolve(a.get('A') as never) as Map<string, { bytes: Uint8Array }>).get('URI')!).bytes))
    expect(uris).toEqual(['https://example.com/a', 'mailto:me@example.com'])
    const [x0, y0, x1, y1] = annots[0].get('Rect') as number[]
    const { chars } = await pageChars(doc, 0)
    const at = chars.map((c) => c.text).join('').indexOf('the site')
    expect(x0).toBeCloseTo(chars[at].x0, 0) // over the words, not somewhere else
    expect(x1).toBeCloseTo(chars[at + 7].x1, 0)
    // the box is in PDF space (y up), the letters count from the top: the box covers the letters' height
    expect(y1 - y0).toBeGreaterThan(8)
    expect(792 - y1).toBeLessThan(chars[at].y0 + 1)
    expect(792 - y0).toBeGreaterThan(chars[at].y1 - 1)
    expect(readOutline(doc).map((m) => [m.title, m.page, m.children.map((c) => [c.title, c.page])])).toEqual([['Intro', 0, [['Detail', 0]]], ['Page two', 1, []]])
  })

  // 40 lines of words with a 144 pt picture anchored in the first paragraph; margins 72 pt, so the picture's box with 9 pt
  // clear all round is x 63..225, y 63..225 on a page that is 612 wide
  const words = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ')
  const withPicture = async (wrap: 'square' | 'topBottom', y = 0) => {
    const pdf = await pdfOf(makeDocx({ rels: [['pic', 'image', 'media/pic.png']], parts: { 'word/media/pic.png': PIXEL }, body: `<w:p><w:r><w:t xml:space="preserve">${words}</w:t></w:r>${placed(wrap, 144, 0, y)}</w:p><w:sectPr>${pg}</w:sectPr>` }))
    const doc = await PdfDocument.load(pdf)
    return { doc, chars: (await pageChars(doc, 0)).chars.filter((c) => c.text.trim()), pdf }
  }

  test('text goes around a picture with square wrapping: beside it, never over it, and the full width again below it', async () => {
    const { chars, pdf } = await withPicture('square')
    expect(new TextDecoder('latin1').decode(pdf)).toContain('/Subtype /Image') // drawn (a see-through picture is an image and its mask)
    // every letter level with the picture starts to its right (its box ends at 225)
    const level = chars.filter((c) => c.y1 > 63 && c.y0 < 225)
    expect(level.length).toBeGreaterThan(50)
    expect(Math.min(...level.map((c) => c.x0))).toBeGreaterThan(224)
    // lines below it use the whole width again, and the lines beside it are narrower than that (they wrap at the right margin, 540)
    expect(Math.min(...chars.filter((c) => c.y0 > 226).map((c) => c.x0))).toBeLessThan(75)
    expect(Math.max(...level.map((c) => c.x1))).toBeLessThan(541)
  })

  test('a picture goes with the paragraph it is anchored in when that paragraph moves to the next page', async () => {
    const five = `<w:p><w:pPr><w:spacing w:line="240" w:lineRule="exact"/><w:keepLines/></w:pPr><w:r>${['K1', 'K2', 'K3', 'K4', 'K5'].map((t) => `<w:t>${t}</w:t>`).join('<w:br/>')}</w:r>${placed('square', 40)}</w:p>`
    const doc = await PdfDocument.load(await pdfOf(makeDocx({ rels: [['pic', 'image', 'media/pic.png']], parts: { 'word/media/pic.png': PIXEL }, body: filler(50) + five + `<w:sectPr>${pg}</w:sectPr>` })))
    const pictures = (i: number) => {
      const xo = (doc.resolve(doc.pages()[i].dict.get('Resources')) as Map<string, never>).get('XObject')
      const d = xo ? (doc.resolve(xo) as Map<string, unknown>) : undefined
      return d?.size ?? 0
    }
    expect(doc.pages()).toHaveLength(2)
    expect(pictures(0)).toBe(0)
    expect(pictures(1)).toBeGreaterThan(0)
  })

  test('with top and bottom wrapping no text is level with the picture: it goes above or below', async () => {
    const { chars } = await withPicture('topBottom', 36) // the box is y 99..261
    expect(chars.some((c) => c.y1 <= 99.5)).toBe(true)
    expect(chars.some((c) => c.y0 >= 260.5)).toBe(true)
    expect(chars.filter((c) => c.y1 > 99.5 && c.y0 < 260.5)).toEqual([])
  })

  test('a page number field that has no saved result still shows the number', async () => {
    const pdf = await pdfOf(
      makeDocx({
        rels: [['f', 'footer', 'f.xml']],
        parts: { 'word/f.xml': part('ftr', '<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r><w:fldSimple w:instr="NUMPAGES"/></w:p>') },
        body: para('One') + para('Two', '<w:pageBreakBefore/>') + `<w:sectPr><w:footerReference w:type="default" r:id="f"/>${pg}</w:sectPr>`,
      }),
    )
    expect(await pageText(pdf, 0)).toContain('Page 12')
    expect(await pageText(pdf, 1)).toContain('Page 22')
  })

  test('a font stored in the document is used for its text, unless its licence forbids embedding', async () => {
    const guid = '{00112233-4455-6677-8899-AABBCCDDEEFF}'
    const run = '<w:p><w:r><w:rPr><w:rFonts w:ascii="Quirky"/></w:rPr><w:t>AAA</w:t></w:r></w:p>'
    const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
    const made = async (font: Uint8Array) => latin1(await pdfOf(withFonts([['Quirky', scramble(font, guid), guid]], run + `<w:sectPr>${pg}</w:sectPr>`)))
    expect(await made(makeTtf())).toContain('TestFont') // its own name is in the file's font, not the bundled stand-in's
    expect(await made(makeTtf({ fsType: 2 }))).not.toContain('TestFont') // "restricted licence": left out, the look-alike is used
  })

  const pictureDoc = (body: string) => makeDocx({ rels: [['pic', 'image', 'media/pic.png']], parts: { 'word/media/pic.png': PIXEL }, body: `${body}<w:sectPr>${pg}</w:sectPr>` })
  const picturesOn = async (body: string) => {
    const doc = await PdfDocument.load(await pdfOf(pictureDoc(body)))
    const page = await pageChars(doc, 0)
    return { pictures: page.pictures, chars: page.chars.filter((c) => c.text.trim()) }
  }

  test('a picture in a line goes where its paragraph puts it, on the baseline, with the text around it', async () => {
    // centred: the middle of the 468 pt column is x = 306
    const { pictures: [centred] } = await picturesOn(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${inline(100, 50)}</w:p>`)
    expect((centred.x0 + centred.x1) / 2).toBeCloseTo(306, 0)
    expect(centred.x1 - centred.x0).toBeCloseTo(100, 0)
    expect(centred.y0).toBeCloseTo(72, 0) // the line starts at the top margin, so the picture does (it isn't pushed down by an empty line first)
    // in the middle of text: the words come before and after it, on its line, and the picture stands on their baseline
    const { pictures: [mid], chars } = await picturesOn(`<w:p><w:r><w:t>AAA </w:t></w:r>${inline(40)}<w:r><w:t xml:space="preserve"> BBB</w:t></w:r></w:p>`)
    const x = (s: string) => chars.find((c) => c.text === s)!
    expect(x('A').x1).toBeLessThan(mid.x0)
    expect(mid.x1).toBeLessThan(x('B').x0)
    expect(mid.y1).toBeCloseTo(x('A').y0, 0) // a letter's place is its baseline: the picture's bottom edge stands on it
    expect(mid.y1 - mid.y0).toBeCloseTo(40, 0)
  })

  test('a picture\'s crop decides what shows in its box: a negative one adds empty room (a thin divider in a taller box), a positive one cuts', async () => {
    // a 100 x 50 box whose picture is cut by nothing at the top but given 566.667% of its own height as room below: it is 1/6.67 of the box tall, at the top
    const { pictures: [line] } = await picturesOn(`<w:p>${inline(100, 50, '<a:srcRect b="-566667"/>')}</w:p>`)
    expect(line.x1 - line.x0).toBeCloseTo(100, 0)
    expect(line.y1 - line.y0).toBeCloseTo(7.5, 0)
    expect(line.y0).toBeCloseTo(72, 0)
    // a quarter cut from the left: the whole picture is drawn a third wider than the box, so its left part is outside it (the box clips)
    const { pictures: [cut] } = await picturesOn(`<w:p>${inline(100, 50, '<a:srcRect l="25000"/>')}</w:p>`)
    expect(cut.x1 - cut.x0).toBeCloseTo(133.3, 0)
    expect(cut.x0).toBeCloseTo(72 - 33.3, 0)
    // without a crop nothing changes
    const { pictures: [plain] } = await picturesOn(`<w:p>${inline(100, 50)}</w:p>`)
    expect([plain.x1 - plain.x0, plain.y1 - plain.y0].map(Math.round)).toEqual([100, 50])
  })

  test('a picture too wide for the column, or taller than a page, is shrunk to fit with its shape kept', async () => {
    const { pictures: [wide] } = await picturesOn(`<w:p>${inline(1000, 500)}</w:p>`)
    expect(wide.x1 - wide.x0).toBeLessThanOrEqual(468.5)
    expect((wide.y1 - wide.y0) / (wide.x1 - wide.x0)).toBeCloseTo(0.5, 2)
    const { pictures: [tall] } = await picturesOn(`<w:p>${inline(100, 3000)}</w:p>`)
    expect(tall.y1 - tall.y0).toBeLessThanOrEqual(648)
    expect((tall.y1 - tall.y0) / (tall.x1 - tall.x0)).toBeCloseTo(30, 0)
  })

  test('text in a table cell taller than it is centred or bottom aligned inside the cell\'s margins', async () => {
    const cell = (props: string) => `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="1440" w:hRule="atLeast"/></w:trPr><w:tc><w:tcPr>${props}</w:tcPr>${para('X')}</w:tc></w:tr></w:tbl>`
    const at = async (props: string) => {
      const { chars } = await picturesOn(cell(props))
      return (chars[0].y0 + chars[0].y1) / 2 - 72 // from the top of the 72 pt row
    }
    expect(await at('')).toBeLessThan(14)
    expect(await at('<w:vAlign w:val="center"/>')).toBeCloseTo(36, -1)
    expect(await at('<w:vAlign w:val="bottom"/>')).toBeGreaterThan(58)
    // a margin of 20 pt above the text moves it down by that much
    expect((await at('<w:tcMar><w:top w:w="400" w:type="dxa"/></w:tcMar>')) - (await at(''))).toBeCloseTo(20, 0)
  })

  test('numbers that are not numbers, or absurd ones, in a file never stop the conversion (a header found one that looped for ever)', async () => {
    const pdf = await pdfOf(
      makeDocx({
        rels: [['h', 'header', 'h.xml']],
        parts: { 'word/h.xml': part('hdr', '<w:p><w:pPr><w:spacing w:before="NaN" w:after="1e308" w:line="x" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:sz w:val="0"/></w:rPr><w:t>Head</w:t></w:r></w:p>') },
        body: `<w:p><w:pPr><w:spacing w:before="99999999999" w:after="-99999999999"/><w:ind w:left="NaN" w:right="1e308"/></w:pPr><w:r><w:t>Body text</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="h"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="NaN" w:right="x" w:bottom="1440" w:left="1440" w:header="1e308" w:footer="-1"/></w:sectPr>`,
      }),
    )
    expect((await PdfDocument.load(pdf)).pages().length).toBeGreaterThan(0)
    expect(await pageText(pdf, 0)).toContain('Head')
  })

  const settingsRel: [string, string, string][] = [['rSet', 'settings', 'settings.xml']]
  const settings = (inner: string) => `<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${inner}</w:settings>`

  test('tab stops: a right stop with dots (a table of contents line), a stop in the middle, and the default stops every 36 pt', async () => {
    const stops = '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs>'
    const toc = await PdfDocument.load(await pdfOf(makeDocx({ body: `<w:p><w:pPr>${stops}</w:pPr><w:r><w:t>Chapter one</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>12</w:t></w:r></w:p><w:sectPr>${pg}</w:sectPr>` })))
    const chars = (await pageChars(toc, 0)).chars.filter((c) => c.text.trim())
    const text = chars.map((c) => c.text).join('')
    expect(text).toMatch(/^Chapterone\.{20,}12$/) // dots fill the tab, then the number (spaces aren't in the letters)
    expect(chars[chars.length - 1].x1).toBeCloseTo(540, 0) // the number ends at the right stop (72 + 468)
    expect(chars[0].x0).toBeCloseTo(72, 0)
    // no stop set: the next multiple of 36 pt from the margin
    const plain = await PdfDocument.load(await pdfOf(makeDocx({ body: `<w:p><w:r><w:t>A</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>B</w:t></w:r></w:p><w:sectPr>${pg}</w:sectPr>` })))
    const [, b] = (await pageChars(plain, 0)).chars.filter((c) => c.text.trim())
    expect(b.x0).toBeCloseTo(72 + 36, 0)
    // a centre stop puts the middle of what follows on it
    const mid = await PdfDocument.load(await pdfOf(makeDocx({ body: `<w:p><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/></w:tabs></w:pPr><w:r><w:tab/></w:r><w:r><w:t>MID</w:t></w:r></w:p><w:sectPr>${pg}</w:sectPr>` })))
    const m = (await pageChars(mid, 0)).chars.filter((c) => c.text.trim())
    expect((m[0].x0 + m[2].x1) / 2).toBeCloseTo(72 + 234, 0)
  })

  test('odd and even pages can have their own headers; the number of the first page and how numbers are written can be set', async () => {
    const pages = (body: string) => body + para('Two', '<w:pageBreakBefore/>') + para('Three', '<w:pageBreakBefore/>')
    const pdf = await pdfOf(
      makeDocx({
        rels: [...settingsRel, ['h', 'header', 'h.xml'], ['he', 'header', 'he.xml'], ['f', 'footer', 'f.xml']],
        parts: {
          'word/settings.xml': settings('<w:evenAndOddHeaders/>'),
          'word/h.xml': part('hdr', para('ODDHEAD')),
          'word/he.xml': part('hdr', para('EVENHEAD')),
          'word/f.xml': part('ftr', '<w:p><w:r><w:t xml:space="preserve">No </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>'),
        },
        body: pages(para('One')) + `<w:sectPr><w:headerReference w:type="default" r:id="h"/><w:headerReference w:type="even" r:id="he"/><w:footerReference w:type="default" r:id="f"/>${pg}<w:pgNumType w:start="4" w:fmt="lowerRoman"/></w:sectPr>`,
      }),
    )
    // numbering starts at 4 (iv), so the first page is an even one
    expect(await pageText(pdf, 0)).toContain('EVENHEAD')
    expect(await pageText(pdf, 1)).toContain('ODDHEAD')
    expect(await pageText(pdf, 2)).toContain('EVENHEAD')
    // only the usual footer is defined, so even pages (iv, vi) show none and the odd one shows its number in roman, as the section says
    const labels = await Promise.all([0, 1, 2].map(async (i) => (await pageText(pdf, i)).match(/No (\w+)/)?.[1]))
    expect(labels).toEqual([undefined, 'v', undefined])
  })

  test('a table is on the left (its text on the margin in older documents, its edge in Word 2013 mode), in the middle or on the right', async () => {
    const table = (props: string) => `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/>${props}</w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>${para('X')}</w:tc></w:tr></w:tbl>`
    const xOf = async (props: string, compat = false) => {
      const docx = await makeDocx({ rels: settingsRel, parts: { 'word/settings.xml': settings(compat ? '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="x" w:val="15"/></w:compat>' : '') }, body: table(props) + `<w:sectPr>${pg}</w:sectPr>` })
      return (await pageChars(await PdfDocument.load(await pdfOf(Promise.resolve(docx))), 0)).chars.find((c) => c.text === 'X')!.x0
    }
    expect(await xOf('')).toBeCloseTo(72, 0) // text on the margin: the edge is 5.4 pt outside it
    expect(await xOf('', true)).toBeCloseTo(72 + 5.4, 0)
    expect(await xOf('<w:jc w:val="center"/>')).toBeCloseTo(72 + (468 - 200) / 2 + 5.4, 0)
    expect(await xOf('<w:jc w:val="right"/>')).toBeCloseTo(72 + 468 - 200 + 5.4, 0)
    expect(await xOf('<w:tblInd w:w="720" w:type="dxa"/>', true)).toBeCloseTo(72 + 36 + 5.4, 0)
  })

  test('a table that goes on to the next page shows its heading rows again at the top of it', async () => {
    const row = (t: string, header = false) => `<w:tr><w:trPr><w:trHeight w:val="240" w:hRule="exact"/>${header ? '<w:tblHeader/>' : ''}</w:trPr><w:tc><w:tcPr/><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p></w:tc></w:tr>`
    const rows = row('HEADROW', true) + Array.from({ length: 70 }, (_, i) => row(`R${i + 1}x`)).join('')
    const pdf = await pdfOf(makeDocx({ body: `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>${rows}</w:tbl><w:sectPr>${pg}</w:sectPr>` }))
    expect(await pageText(pdf, 0)).toMatch(/^HEADROW R1x/)
    expect(await pageText(pdf, 1)).toMatch(/^HEADROW R5\dx/) // page 1 holds 54 rows (the heading and 53 of the others), so page 2 goes on from the next
  })

  test('a footnote is at the bottom of the page its mark is on, which keeps the room it needs; endnotes come at the end', async () => {
    const noted = (n: number, extra = '') => makeDocx({ rels: [['fn', 'footnotes', 'footnotes.xml'], ['en', 'endnotes', 'endnotes.xml']], parts: { 'word/footnotes.xml': notesPart('footnotes', [['1', 'FOOTONE'], ['2', 'FOOTTWO']]), 'word/endnotes.xml': notesPart('endnotes', [['1', 'ENDNOTE']]) }, body: filler(n) + extra + `<w:sectPr>${pg}</w:sectPr>` })
    const mark = (id: string, kind: 'footnote' | 'endnote' = 'footnote') => `<w:p><w:pPr><w:spacing w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:t>Marked</w:t></w:r>${noteMark(kind, id)}</w:p>`
    // a mark early on the page: its note is on that page, below the text, with a rule above it
    const early = await pdfOf(noted(3, mark('1')))
    const { chars } = await pageChars(await PdfDocument.load(early), 0)
    const note = chars.filter((c) => c.text.trim()).map((c) => c.text).join('')
    expect(note).toContain('FOOTONE')
    const o = chars.find((c) => c.text === 'O' && note.indexOf('FOOTONE') >= 0)!
    expect(o.y0).toBeGreaterThan(792 - 72 - 40) // at the foot of the page, not under the mark
    // 52 lines fill all but two lines of the page: a line with a note that takes more than that goes to the next page, with its note
    const late = await pdfOf(noted(52, mark('1')))
    expect(await pageText(late, 0)).not.toContain('FOOTONE')
    expect(await pageText(late, 1)).toContain('Marked')
    expect(await pageText(late, 1)).toContain('FOOTONE')
    // two marks, two notes in order, numbered 1 and 2
    const two = await pdfOf(noted(3, mark('1') + mark('2')))
    expect(await pageText(two, 0)).toMatch(/1 FOOTONE 2 FOOTTWO/)
    // endnotes after the last text
    const end = await pdfOf(noted(3, mark('1', 'endnote')))
    expect(await pageText(end, 0)).toMatch(/Markedi.*i ENDNOTE/)
  })

  test('links to a bookmark jump to where it is, and a page reference shows the page it is really on (not the one the file saved)', async () => {
    const entry = (target: string, saved: string) =>
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs></w:pPr><w:hyperlink w:anchor="${target}"><w:r><w:t>Chapter</w:t></w:r><w:r><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF ${target} \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${saved}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink></w:p>`
    const target = (name: string) => `<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:bookmarkStart w:id="1" w:name="${name}"/><w:r><w:t>The chapter</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>`
    const pdf = await pdfOf(makeDocx({ body: entry('chap', '9') + entry('nowhere', '7') + target('chap') + `<w:sectPr>${pg}</w:sectPr>` }))
    const doc = await PdfDocument.load(pdf)
    // the number is the page the bookmark is on (2), and the one with no bookmark keeps what the file saved
    expect(await pageText(pdf, 0)).toMatch(/Chapter\.+2 Chapter\.+7/)
    // one link, to the second page, and none for the bookmark that isn't there
    const annots = (doc.resolve(doc.pages()[0].dict.get('Annots')) as unknown as PdfObj[]).map((r) => doc.resolve(r) as Map<string, PdfObj>)
    expect(annots.filter((a) => a.get('Dest'))).toHaveLength(2) // the words and the page number of the one entry
    for (const a of annots) expect(doc.resolve(((doc.resolve(a.get('Dest')) as unknown as PdfObj[])[0]))).toBe(doc.pages()[1].dict)
  })

  const sect = (inner: string) => `<w:p><w:pPr><w:sectPr>${inner}${pg}</w:sectPr></w:pPr></w:p>`
  const cols2 = '<w:cols w:num="2" w:space="720"/>'

  test('text in columns fills the first column, then the second, then goes to the next page', async () => {
    const doc = await PdfDocument.load(await pdfOf(makeDocx({ body: lines('L', 130) + `<w:sectPr>${cols2}${pg}</w:sectPr>` })))
    expect(doc.pages().length).toBe(2) // 54 lines to a column: 108 on the first page, the other 22 on the second
    const chars = (await pageChars(doc, 0)).chars.filter((c) => c.text.trim())
    const at = (label: string, from = chars) => from.find((c, i) => from.slice(i, i + label.length).map((x) => x.text).join('') === label)!
    // columns 216 pt wide, 36 apart: the second starts at 72 + 216 + 36 = 324, at the same height as the first
    expect(at('L1').x0).toBeCloseTo(72, 0)
    expect(at('L55').x0).toBeCloseTo(324, 0)
    expect(at('L55').y0).toBeCloseTo(at('L1').y0, 0)
    expect(Math.max(...chars.filter((c) => c.x0 < 300).map((c) => c.x1))).toBeLessThanOrEqual(288.5)
    const next = (await pageChars(doc, 1)).chars.filter((c) => c.text.trim())
    expect(at('L109', next).x0).toBeCloseTo(72, 0) // the next page starts again in the first column
  })

  test('columns before a continuous break are balanced, and what follows starts below them, back at the full width', async () => {
    const body = para('TITLE') + sect('') + lines('L', 40) + sect(`<w:type w:val="continuous"/>${cols2}`) + para('AFTER') + `<w:sectPr><w:type w:val="continuous"/>${pg}</w:sectPr>`
    const doc = await PdfDocument.load(await pdfOf(makeDocx({ body })))
    expect(doc.pages()).toHaveLength(1)
    const chars = (await pageChars(doc, 0)).chars.filter((c) => c.text.trim())
    const at = (label: string) => chars.find((c, i) => chars.slice(i, i + label.length).map((x) => x.text).join('') === label)!
    // 40 lines would all fit in the first column; balanced, about half are in each (the empty paragraph that carries the section break
    // is the last line of the second, so the first has 21)
    expect(at('L1').x0).toBeCloseTo(72, 0)
    expect(at('L20').x0).toBeCloseTo(72, 0)
    expect(at('L22').x0).toBeCloseTo(324, 0)
    expect(at('L22').y0).toBeCloseTo(at('L1').y0, 0)
    // the second part starts under the tallest column, at the left margin
    expect(at('AFTER').x0).toBeCloseTo(72, 0)
    expect(at('AFTER').y0).toBeGreaterThan(at('L20').y0)
    expect(at('AFTER').y0).toBeLessThan(at('L20').y0 + 40)
  })

  test('a section that must start on an odd page leaves a blank page when it would start on an even one', async () => {
    const pdf = await pdfOf(makeDocx({ body: para('FIRST') + sect('') + para('SECOND') + `<w:sectPr><w:type w:val="oddPage"/>${pg}</w:sectPr>` }))
    const doc = await PdfDocument.load(pdf)
    expect(doc.pages()).toHaveLength(3)
    expect(await pageText(pdf, 0)).toContain('FIRST')
    expect(await pageText(pdf, 1)).toBe('')
    expect(await pageText(pdf, 2)).toContain('SECOND')
  })

  test('a table row with more text than fits goes on over the page break, between lines, with its borders; a row that may not split moves whole', async () => {
    const cell = (n: number, lineProps = '') => `<w:tc><w:tcPr><w:tcBorders><w:top w:val="single" w:sz="8" w:color="000000"/><w:bottom w:val="single" w:sz="8" w:color="000000"/></w:tcBorders></w:tcPr>${lines('C', n, lineProps)}</w:tc>`
    const table = (rowProps: string, n: number) => `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr>${rowProps ? `<w:trPr>${rowProps}</w:trPr>` : ''}${cell(n)}</w:tr></w:tbl><w:sectPr>${pg}</w:sectPr>`
    // one cell of 130 lines: 54 on the first page, 54 on the second, the rest on the third: nothing is lost
    const long = await pdfOf(makeDocx({ body: table('', 130) }))
    const doc = await PdfDocument.load(long)
    expect(doc.pages()).toHaveLength(3)
    expect(await pageText(long, 0)).toMatch(/^C1 C2 /)
    expect(await pageText(long, 1)).toMatch(/^C55 C56 /)
    expect(await pageText(long, 2)).toMatch(/C130$/)
    // after some text a row of 60 lines doesn't fit in what is left: it starts right there and goes on, where "can't split" moves it to the next page
    const some = filler(40)
    const split = await pdfOf(makeDocx({ body: some + table('', 60) }))
    expect(await pageText(split, 0)).toContain('C1 C2')
    expect(await pageText(split, 1)).toMatch(/^C\d+ /)
    const whole = await pdfOf(makeDocx({ body: some + table('<w:cantSplit/>', 60) }))
    expect(await pageText(whole, 0)).not.toContain('C1 C2')
    expect(await pageText(whole, 1)).toMatch(/^C1 C2 /)
  })

  test('run: the file and its errors', async () => {
    const f = (name: string, bytes: Uint8Array) => ({ name, type: '', bytes })
    const docx = await makeDocx({ body: para('Hello') + `<w:sectPr>${pg}</w:sectPr>` })
    const [out] = await wordToPdf([f('Report.docx', docx)], { localFonts: [] }, { progress: () => {} }, nodeFonts)
    expect(out.name).toBe('Report.pdf')
    expect(await pageText(out.bytes, 0)).toContain('Hello')
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])
    await expect(wordToPdf([f('old.doc', ole)], { localFonts: [] }, { progress: () => {} }, nodeFonts)).rejects.toThrow(/^old\.doc: This is an older Word file \(\.doc\).*\.docx/)
    await expect(wordToPdf([f('book.docx', fx('charts.xlsx').bytes)], { localFonts: [] }, { progress: () => {} }, nodeFonts)).rejects.toThrow(/book\.docx: .*isn't a Word document/)
  })
})
