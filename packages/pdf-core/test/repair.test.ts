import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfParseError, repairPdf } from '../src/index.ts'
import { ascii, latin1 } from '../src/bytes.ts'
import { brokenXrefPdf, classicPdf, pageTexts, wrongLengthPdf } from './helpers.ts'

const abc = ['Alpha', 'Beta', 'Gamma']

describe('repairPdf', () => {
  test('a healthy file comes back as a clean copy with nothing reported', async () => {
    const r = await repairPdf(classicPdf(abc))
    expect(r).toMatchObject({ rebuilt: false, treeFixed: false, pages: 3 })
    expect(await pageTexts(r.bytes)).toEqual(abc)
  })

  test('a wrong cross-reference table is rebuilt and the result needs no rebuilding', async () => {
    const r = await repairPdf(brokenXrefPdf(abc))
    expect(r).toMatchObject({ rebuilt: true, pages: 3 })
    expect(await pageTexts(r.bytes)).toEqual(abc)
    expect((await PdfDocument.load(r.bytes)).rebuilt).toBe(false)
    const lengths = await repairPdf(wrongLengthPdf(abc))
    expect(await pageTexts(lengths.bytes)).toEqual(abc)
  })

  test('a file cut short keeps the pages that are whole', async () => {
    const whole = classicPdf(abc)
    const text = latin1(whole)
    const cut = ascii(text.slice(0, text.indexOf('6 0 obj') + 40)) // inside the second page's object
    const r = await repairPdf(cut)
    expect(r.rebuilt).toBe(true)
    expect(r.treeFixed).toBe(true)
    expect(r.pages).toBe(1)
    expect(await pageTexts(r.bytes)).toEqual(['Alpha'])
    const reload = await PdfDocument.load(r.bytes)
    expect(reload.rebuilt).toBe(false)
    expect(reload.pages().length).toBe(1)
  })

  test('a lost catalog is replaced and the pages are found by scanning', async () => {
    const text = latin1(classicPdf(abc))
    const noCatalog = text.replace('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj', '').replace(/<< \/Type \/Pages [^>]*>>\nendobj/, 'endobj')
    expect(noCatalog).not.toContain('/Catalog')
    const r = await repairPdf(ascii(noCatalog))
    expect(r.treeFixed).toBe(true)
    expect(r.pages).toBe(3)
    expect(await pageTexts(r.bytes)).toEqual(abc)
  })

  test('a file with no pages, or not a PDF, is refused with a readable message', async () => {
    const empty = latin1(classicPdf([])).replace('/Kids []', '/Kids []')
    await expect(repairPdf(ascii(empty))).rejects.toBeInstanceOf(PdfParseError)
    await expect(repairPdf(ascii('hello'))).rejects.toThrow("isn't a PDF")
  })
})
