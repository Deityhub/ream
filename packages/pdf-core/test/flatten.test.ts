import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfStream, decodeStream, fillForm, flattenPdf, readForm } from '../src/index.ts'
import { assemble, formPdf } from './helpers.ts'

const text = async (doc: PdfDocument, page = 0) => {
  const c = doc.resolve(doc.pages()[page].dict.get('Contents'))
  const parts = Array.isArray(c) ? c : [c]
  let out = ''
  for (const p of parts) {
    const s = doc.resolve(p as never)
    if (s instanceof PdfStream) out += new TextDecoder('latin1').decode(await decodeStream(s))
  }
  return out
}
const annotCount = (doc: PdfDocument) => {
  const a = doc.resolve(doc.pages()[0].dict.get('Annots'))
  return Array.isArray(a) ? a.length : 0
}

describe('flattenPdf: forms', () => {
  test('filled fields become page content and the form is gone', async () => {
    const filled = await fillForm(await PdfDocument.load(formPdf()), { name: 'Ada Lovelace', agree: true, size: 'S' })
    const { bytes, flattened } = await flattenPdf(await PdfDocument.load(filled), { forms: true, comments: false })
    const doc = await PdfDocument.load(bytes)
    expect(readForm(doc).fields).toEqual([])
    expect(doc.catalog().has('AcroForm')).toBe(false)
    expect(annotCount(doc)).toBe(0)
    const content = await text(doc)
    expect(flattened).toBeGreaterThanOrEqual(5)
    expect(content.match(/\/ReamFlat\d+ Do/g)).toHaveLength(flattened)
    // the text is inside the picture of the first field
    const res = doc.resolve(doc.pages()[0].dict.get('Resources')) as Map<string, unknown>
    const xo = doc.resolve(res.get('XObject') as never) as Map<string, unknown>
    const first = doc.resolve(xo.get('ReamFlat0') as never) as PdfStream
    expect(new TextDecoder('latin1').decode(await decodeStream(first))).toContain('<4164')
  })

  test('forms: false leaves the fields alone', async () => {
    const { bytes, flattened } = await flattenPdf(await PdfDocument.load(formPdf()), { forms: false, comments: true })
    expect(flattened).toBe(0)
    expect(readForm(await PdfDocument.load(bytes)).fields.length).toBe(7)
  })

  test('a text field with no picture is drawn from its value', async () => {
    const { bytes } = await flattenPdf(await PdfDocument.load(formPdf()), { forms: true, comments: false })
    const doc = await PdfDocument.load(bytes)
    const res = doc.resolve(doc.pages()[0].dict.get('Resources')) as Map<string, unknown>
    const xo = doc.resolve(res.get('XObject') as never) as Map<string, unknown>
    const streams = await Promise.all([...xo.values()].map(async (r) => new TextDecoder('latin1').decode(await decodeStream(doc.resolve(r as never) as PdfStream))))
    expect(streams.some((s) => s.includes('<416e6e>'))).toBe(true) // "Ann", the value the file had
  })
})

describe('flattenPdf: comments', () => {
  const pdf = () => {
    const ap = (c: string) => `<< /Type /XObject /Subtype /Form /BBox [0 0 50 10] /Length ${c.length} >>\nstream\n${c}\nendstream`
    return assemble([
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, '<< /Type /Pages /Kids [4 0 R] /Count 1 >>'],
      [4, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [10 0 R 11 0 R 12 0 R] >>'],
      [10, '<< /Type /Annot /Subtype /Highlight /Rect [20 20 120 40] /AP << /N 20 0 R >> >>'],
      [11, '<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /URI /URI (https://example.org) >> >>'],
      [12, '<< /Type /Annot /Subtype /Stamp /Rect [20 100 70 110] /F 2 /AP << /N 20 0 R >> >>'], // hidden
      [20, ap('1 1 0 rg 0 0 50 10 re f')],
    ]).bytes
  }

  test('markup is drawn into the page, scaled to its rectangle; links stay; hidden ones just go', async () => {
    const { bytes, flattened } = await flattenPdf(await PdfDocument.load(pdf()), { forms: true, comments: true })
    expect(flattened).toBe(1)
    const doc = await PdfDocument.load(bytes)
    const left = doc.resolve(doc.pages()[0].dict.get('Annots')) as unknown[]
    expect(left).toHaveLength(1)
    expect((doc.resolve(left[0] as never) as Map<string, unknown>).get('Subtype')).toMatchObject({ value: 'Link' })
    // 50x10 box onto 100x20: scale 2, moved to (20, 20)
    expect(await text(doc)).toContain('q 2 0 0 2 20 20 cm /ReamFlat0 Do Q')
  })

  test('comments: false keeps them', async () => {
    const { bytes, flattened } = await flattenPdf(await PdfDocument.load(pdf()), { forms: true, comments: false })
    expect(flattened).toBe(0)
    expect(annotCount(await PdfDocument.load(bytes))).toBe(3)
  })
})
