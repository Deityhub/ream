import { describe, expect, test } from 'vitest'
import {
  PdfDocument, PdfEncryptedError, PdfRangeError, extract, merge, parseRanges, chunks, remove, rotate, split, isName,
} from '../src/index.ts'
import { brokenXrefPdf, classicPdf, encryptedPdf, incrementalPdf, pageTexts, wrongLengthPdf, xrefStreamPdf } from './helpers.ts'

const abc = ['A', 'B', 'C']

describe('loading variants', () => {
  test('classic xref', async () => expect(await pageTexts(classicPdf(abc))).toEqual(abc))
  test('xref stream + object stream + predictor', async () => expect(await pageTexts(await xrefStreamPdf(abc))).toEqual(abc))
  test('incremental update: newest object wins', async () => expect(await pageTexts(incrementalPdf())).toEqual(['New']))
  test('wrong /Length', async () => expect(await pageTexts(wrongLengthPdf(abc))).toEqual(abc))
  test('broken startxref rebuilds by scanning', async () => expect(await pageTexts(brokenXrefPdf(abc))).toEqual(abc))
  test('encrypted PDFs are refused with a readable error', async () => {
    await expect(PdfDocument.load(encryptedPdf(abc))).rejects.toBeInstanceOf(PdfEncryptedError)
  })
  test('not a PDF', async () => {
    await expect(PdfDocument.load(new TextEncoder().encode('hello'))).rejects.toThrow("isn't a PDF")
  })
})

describe('operations', () => {
  const sources = {
    classic: async () => classicPdf(['A', 'B', 'C', 'D']),
    xrefStream: () => xrefStreamPdf(['A', 'B', 'C', 'D']),
  }
  for (const [label, make] of Object.entries(sources)) {
    test(`extract / remove / split on ${label}`, async () => {
      const doc = await PdfDocument.load(await make())
      expect(await pageTexts(extract(doc, [3, 0]))).toEqual(['D', 'A'])
      expect(await pageTexts(remove(doc, [1, 2]))).toEqual(['A', 'D'])
      const parts = split(doc, [[0, 1], [2, 3]])
      expect(await Promise.all(parts.map(pageTexts))).toEqual([['A', 'B'], ['C', 'D']])
    })
  }

  test('merge keeps order across files and styles', async () => {
    const a = await PdfDocument.load(classicPdf(['A1', 'A2']))
    const b = await PdfDocument.load(await xrefStreamPdf(['B1', 'B2']))
    expect(await pageTexts(merge([{ doc: a }, { doc: b, pages: [1] }, { doc: a, pages: [0] }]))).toEqual(['A1', 'A2', 'B2', 'A1'])
  })

  test('output is a clean flat classic PDF that we can load again', async () => {
    const out = merge([{ doc: await PdfDocument.load(await xrefStreamPdf(abc)) }])
    const doc = await PdfDocument.load(out)
    expect(doc.pages()).toHaveLength(3)
    expect(isName(doc.catalog().get('Type'), 'Catalog')).toBe(true)
    expect(new TextDecoder('latin1').decode(out.subarray(0, 8))).toBe('%PDF-1.7')
  })

  test('rotate adds to the existing rotation, only on chosen pages', async () => {
    const doc = await PdfDocument.load(classicPdf(abc))
    const once = await PdfDocument.load(rotate(doc, 90, [1]))
    const rot = (d: PdfDocument) => d.pages().map((p) => d.resolve(p.dict.get('Rotate')) ?? 0)
    expect(rot(once)).toEqual([0, 90, 0])
    expect(rot(await PdfDocument.load(rotate(once, -180)))).toEqual([180, 270, 180])
    expect(await pageTexts(rotate(doc, 90))).toEqual(abc)
  })

  test('page attributes survive: MediaBox and Resources are explicit on every copied page', async () => {
    const doc = await PdfDocument.load(extract(await PdfDocument.load(classicPdf(abc)), [2]))
    const [page] = doc.pages()
    expect(doc.resolve(page.dict.get('MediaBox'))).toEqual([0, 0, 200, 200])
    expect(page.dict.has('Resources')).toBe(true)
  })

  test('bad input gives readable errors', async () => {
    const doc = await PdfDocument.load(classicPdf(abc))
    expect(() => remove(doc, [0, 1, 2])).toThrow(PdfRangeError)
    expect(() => extract(doc, [7])).toThrow(/Page 8 doesn't exist/)
    expect(() => rotate(doc, 45)).toThrow(/multiple of 90/)
  })
})

describe('ranges', () => {
  test('parse', () => {
    expect(parseRanges('1-3, 5, 8-', 9)).toEqual([[0, 1, 2], [4], [7, 8]])
    expect(chunks(5, 2)).toEqual([[0, 1], [2, 3], [4]])
  })
  test('errors', () => {
    expect(() => parseRanges('', 3)).toThrow(/at least one/)
    expect(() => parseRanges('4', 3)).toThrow(/Page 4 doesn't exist; this PDF has 3 pages/)
    expect(() => parseRanges('3-1', 5)).toThrow(/backwards/)
    expect(() => parseRanges('a-b', 5)).toThrow(/isn't a page or range/)
    expect(() => chunks(5, 0)).toThrow(PdfRangeError)
  })
})
