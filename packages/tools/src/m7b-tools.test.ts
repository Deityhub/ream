import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { FileData } from '@ream/core'
import { decodeJpeg, decodePng } from '@ream/image-core'
import { PdfDocument } from '@ream/pdf-core'
import type { PageRaster } from '@ream/pdf-render'
import { readXlsx, writeXlsx, parseXml, kids, child, type Sheet, type XmlNode } from '@ream/office-core'
import { unzip } from '@ream/core'
import { extractText } from '@ream/pdf-render'
import { assemble, classicPdf } from '../../pdf-core/test/helpers.ts'
import { run as toImage } from './pdf-to-image/run.ts'
import { run as toExcel } from './pdf-to-excel/run.ts'
import { run as excelToPdf } from './excel-to-pdf/run.ts'
import { run as toWord } from './pdf-to-word/run.ts'
import { run as toPowerpoint } from './pdf-to-powerpoint/run.ts'
import { run as powerpointToPdf } from './powerpoint-to-pdf/run.ts'
import { readPptx } from '@ream/office-core'
import { familyOf } from './office-fonts.ts'
import { parseNumber } from './pdf-to-excel/number.ts'

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
  const o = { paper: 'a4' as const, orientation: 'auto' as const, fit: 'width' as const, gridlines: false, fontFile: null, fontName: '' }
  const text = async (f: FileData, page = 0) => {
    const doc = await PdfDocument.load(f.bytes)
    return (await extractText(doc, [page], { markdown: false }))[0]
  }
  const grid = (n: number, cols = 3): Sheet['rows'] => Array.from({ length: n }, (_, r) => Array.from({ length: cols }, (_, c) => ({ value: `r${r}c${c}` })))

  test('cells keep their text, numbers show as formatted, a title row and the page size come out right', async () => {
    const [out] = await excelToPdf([await xlsx([{ name: 'S', rows: [[{ value: 'Item', style: { bold: true } }, { value: 'Price' }], [{ value: 'Tea' }, { value: 1234.5, style: { numFmt: '#,##0.00' } }]] }])], o, ctx)
    expect(out.name).toBe('book.pdf')
    const doc = await PdfDocument.load(out.bytes)
    expect(doc.pages()).toHaveLength(1)
    expect(doc.pageSize(doc.pages()[0])).toEqual({ width: 595, height: 842 })
    expect((await text(out)).replace(/ +/g, ' ')).toBe('Item Price\nTea 1,234.50')
  })

  test('long sheets continue on more pages; a wide one is shrunk to one page or split across', async () => {
    const tall = await xlsx([{ name: 'T', rows: grid(120) }])
    expect((await PdfDocument.load((await excelToPdf([tall], o, ctx))[0].bytes)).pages().length).toBeGreaterThan(2)
    const wide = await xlsx([{ name: 'W', rows: grid(5, 30), colWidths: Array(30).fill(12) }])
    const fit = await PdfDocument.load((await excelToPdf([wide], o, ctx))[0].bytes)
    expect(fit.pages()).toHaveLength(1)
    expect(fit.pageSize(fit.pages()[0]).width).toBeGreaterThan(fit.pageSize(fit.pages()[0]).height) // automatic direction chose landscape
    const split = await PdfDocument.load((await excelToPdf([wide], { ...o, fit: 'none' }, ctx))[0].bytes)
    expect(split.pages().length).toBeGreaterThan(2)
  })

  test('hidden sheets, rows and columns are left out; merged and wrapped cells are drawn once', async () => {
    const rows = [[{ value: 'keep' }, { value: 'hidden col' }, { value: 'x' }], [{ value: 'hidden row' }], [{ value: 'a long wrapped sentence that needs several lines', style: { wrap: true } }]]
    const f = await xlsx([{ name: 'A', rows, hiddenCols: [1], hiddenRows: [1], colWidths: [10] }, { name: 'B', rows: grid(2), hidden: true }, { name: 'M', rows: [[{ value: 'wide merge' }, null, null]], merges: [{ row: 0, col: 0, rows: 1, cols: 3 }] }])
    const out = await excelToPdf([f], o, ctx)
    const pages = (await PdfDocument.load(out[0].bytes)).pages().length
    expect(pages).toBe(2) // sheet B is hidden
    const t = (await text(out[0], 0) + ' ' + (await text(out[0], 1))).replace(/\s+/g, ' ')
    expect(t).toContain('keep x')
    expect(t).not.toContain('hidden col')
    expect(t).not.toContain('hidden row')
    expect(t).toContain('long wrapped')
    expect((t.match(/wide merge/g) ?? []).length).toBe(1)
  })

  test('letters the standard fonts lack show as ?; an empty or damaged workbook gives a clear error', async () => {
    const [out] = await excelToPdf([await xlsx([{ name: 'S', rows: [[{ value: 'aЖb' }]] }])], o, ctx)
    expect(await text(out)).toBe('a?b')
    await expect(excelToPdf([await xlsx([{ name: 'S', rows: [] }])], o, ctx)).rejects.toThrow(/nothing to print/)
    await expect(excelToPdf([{ name: 'bad.xlsx', type: '', bytes: new TextEncoder().encode('not a zip file at all, nothing to see here') }], o, ctx)).rejects.toThrow(/bad.xlsx/)
  })

  test('a merged range declared as big as the whole sheet is cut to the cells that are there', async () => {
    const f = await xlsx([{ name: 'S', rows: [[{ value: 'only cell' }]], merges: [{ row: 0, col: 0, rows: 1_048_576, cols: 16_384 }] }])
    const started = Date.now()
    const [out] = await excelToPdf([f], o, ctx)
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
  const ctxo = { pages: '', mode: 'editable' as const, dpi: 150 }
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

  test('editable slides: the page size, text boxes where the text was, a table, and no empty slide', async () => {
    const [out] = await toPowerpoint([pdfOf(page)], base, ctx)
    expect(out.name).toBe('in.pptx')
    const deck = await readPptx(out.bytes)
    expect([deck.width, deck.height]).toEqual([400, 300])
    const shapes = deck.slides[0].shapes
    const boxes = shapes.filter((x) => x.kind === 'text')
    expect(boxes.map((b) => b.kind === 'text' && b.paragraphs[0].runs.map((r) => r.text).join(''))).toEqual(['Slide title', 'A line of body text and a second line.'])
    expect(boxes[0]).toMatchObject({ x: 40 })
    expect(boxes[0].kind === 'text' && boxes[0].paragraphs[0].runs[0]).toMatchObject({ size: 24, bold: true })
    const table = shapes.find((x) => x.kind === 'table')!
    expect(table.kind === 'table' && table.cells.map((r) => r.map((c) => c.paragraphs[0]?.runs[0]?.text))).toEqual([['R1C1', 'R1C2'], ['R2C1', 'R2C2']])
    await expect(toPowerpoint([pdfOf('')], base, ctx)).rejects.toThrow(/Page pictures/)
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
    const [pptx] = await toPowerpoint([pdfOf(page)], base, ctx)
    const [back] = await powerpointToPdf([{ name: 'in.pptx', type: '', bytes: pptx.bytes }], { hidden: false, fontFile: null, fontName: '' }, ctx)
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
    const [out] = await powerpointToPdf([{ name: 'deck.pptx', type: '', bytes }], { hidden: false, fontFile: null, fontName: '' }, ctx)
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
    const [a] = await powerpointToPdf([{ name: 'd.pptx', type: '', bytes: hide(bytes) }], { hidden: true, fontFile: null, fontName: '' }, ctx)
    expect((await PdfDocument.load(a.bytes)).pages()).toHaveLength(3)
    await expect(powerpointToPdf([{ name: 'bad.pptx', type: '', bytes: new TextEncoder().encode('not a presentation at all, not at all at all') }], { hidden: false, fontFile: null, fontName: '' }, ctx)).rejects.toThrow(/bad.pptx/)
  })
})
