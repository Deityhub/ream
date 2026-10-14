import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfStream, PdfString, PdfRangeError, crop, decodeStream, encodeTextString, decodeTextString, isDict, pdfText, readInfo, rotate, setMetadata, stamp, textWidth } from '../src/index.ts'
import { latin1 } from '../src/bytes.ts'
import { classicPdf, pageTexts } from './helpers.ts'

/** the page's content streams joined, as text */
async function content(doc: PdfDocument, i: number): Promise<string> {
  const page = doc.pages()[i]
  const parts = [doc.resolve(page.dict.get('Contents'))].flat().map((c) => doc.resolve(c))
  let out = ''
  for (const c of parts) if (c instanceof PdfStream) out += latin1(await decodeStream(c)) + '\n'
  return out
}

describe('text', () => {
  test('Helvetica widths from the metrics', () => {
    expect(textWidth('Hello', 1000)).toBe(2278)
    expect(textWidth('Hello', 10, { bold: true })).toBeCloseTo(24.45, 2) // H722 e556 l278 l278 o611
    expect(textWidth('é', 1000)).toBe(556) // accented letters are as wide as their base
  })
  test('WinAnsi escaping and unsupported characters', () => {
    expect(pdfText('a(b)\\c')).toBe('(a\\(b\\)\\\\c)')
    expect(pdfText('é€')).toBe('(\\351\\200)')
    expect(() => pdfText('日本')).toThrow(PdfRangeError)
    expect(() => pdfText('日本')).toThrow(/can't be drawn yet/)
  })
  test('text strings round-trip, ASCII as bytes and the rest as UTF-16', () => {
    expect(encodeTextString('Plain').bytes.length).toBe(5)
    const s = encodeTextString('Café ☕')
    expect(s.bytes[0]).toBe(0xfe)
    expect(decodeTextString(s.bytes)).toBe('Café ☕')
  })
})

describe('stamp', () => {
  test('draws on top of every page and keeps the original content', async () => {
    const src = await PdfDocument.load(classicPdf(['A', 'B']))
    const out = await PdfDocument.load(stamp(src, ({ index, width, height }) => ({ content: `BT /ReamHelvetica 10 Tf 0 0 Td (n${index} ${width}x${height}) Tj ET`, fonts: ['Helvetica'] })))
    expect(out.pages()).toHaveLength(2)
    expect(await pageTexts(stamp(src, () => ({ content: 'BT (X) Tj ET' })))).toEqual(['AX', 'BX'])
    const c = await content(out, 1)
    expect(c.indexOf('(B)')).toBeLessThan(c.indexOf('(n1 200x200)')) // over: after the page's own content
    const res = out.resolve(out.pages()[0].dict.get('Resources'))
    const fonts = isDict(res) ? out.resolve(res.get('Font')) : null
    expect(isDict(fonts) && fonts.has('ReamHelvetica') && fonts.has('F1')).toBe(true) // the stamp's font joins the page's own
  })

  test('under puts the stamp first; alpha adds an ExtGState; null skips the page', async () => {
    const src = await PdfDocument.load(classicPdf(['A', 'B']))
    const out = await PdfDocument.load(stamp(src, ({ index }) => (index === 0 ? { content: 'BT (W) Tj ET', alpha: 0.25, under: true } : null)))
    const c = await content(out, 0)
    expect(c.indexOf('(W)')).toBeLessThan(c.indexOf('(A)'))
    expect(c).toContain('/ReamGS gs')
    const res = out.resolve(out.pages()[0].dict.get('Resources'))
    const gs = isDict(res) ? out.resolve(res.get('ExtGState')) : null
    const entry = isDict(gs) ? out.resolve(gs.get('ReamGS')) : null
    expect(isDict(entry) && entry.get('ca')).toBe(0.25)
    expect(await content(out, 1)).not.toContain('(W)')
  })

  test('a rotated page gets its stamp turned with it, and reports the displayed size', async () => {
    const turned = await PdfDocument.load(rotate(await PdfDocument.load(classicPdf(['A'])), 90))
    let seen: [number, number] = [0, 0]
    const out = await PdfDocument.load(stamp(turned, ({ width, height }) => ((seen = [width, height]), { content: '0 0 1 1 re f' })))
    expect(seen).toEqual([200, 200])
    expect(await content(out, 0)).toContain('0 1 -1 0 200 0 cm') // displayed -> user space for 90 degrees clockwise
  })

  test('keeps the document information and stamps a modification date', async () => {
    const src = await PdfDocument.load(setMetadata(await PdfDocument.load(classicPdf(['A'])), { Title: 'Report', Author: 'Zoë' }))
    const info = readInfo(await PdfDocument.load(stamp(src, () => ({ content: '' }))))
    expect(info.Title).toBe('Report')
    expect(info.Author).toBe('Zoë')
    expect(info.ModDate).toMatch(/^D:\d{14}Z$/)
  })
})

describe('crop', () => {
  const boxes = async (bytes: Uint8Array) => {
    const d = await PdfDocument.load(bytes)
    return d.pages().map((p) => d.pageBox(p))
  }
  test('margins shrink the crop box and the displayed size', async () => {
    const src = await PdfDocument.load(classicPdf(['A', 'B']))
    const out = await PdfDocument.load(crop(src, () => [10, 20, 30, 40]))
    expect(out.pageSize(out.pages()[0])).toEqual({ width: 140, height: 160 })
    expect((await boxes(crop(src, () => [10, 20, 30, 40])))[0].box).toEqual([40, 30, 180, 190])
  })
  test('margins are as displayed on rotated pages', async () => {
    // a 200x100 page turned 90 degrees clockwise shows 100 wide, 200 tall; cut 10 from the displayed top only
    const wide = classicPdf(['A']).slice()
    const text = latin1(wide).replace('/MediaBox [0 0 200 200]', '/MediaBox [0 0 200 100] /Rotate 90')
    const doc = await PdfDocument.load(new Uint8Array([...text].map((c) => c.charCodeAt(0))))
    const out = await boxes(crop(doc, () => [10, 0, 0, 0]))
    expect(out[0].box).toEqual([10, 0, 200, 100]) // the displayed top of a 90 degree page is the user-space left
    const back = await PdfDocument.load(crop(doc, () => [10, 0, 0, 0]))
    expect(back.pageSize(back.pages()[0])).toEqual({ width: 100, height: 190 })
  })
  test('margins that leave nothing are an error', () => {
    return PdfDocument.load(classicPdf(['A'])).then((doc) => expect(() => crop(doc, () => [100, 0, 100, 0])).toThrow(/leave nothing of page 1/))
  })
})

describe('setMetadata', () => {
  test('sets, replaces and removes entries, keeping the pages', async () => {
    const doc = await PdfDocument.load(classicPdf(['A', 'B']))
    const one = await PdfDocument.load(setMetadata(doc, { Title: 'First', Keywords: 'a, b' }))
    expect(readInfo(one)).toMatchObject({ Title: 'First', Keywords: 'a, b' })
    const two = await PdfDocument.load(setMetadata(one, { Title: 'Second', Keywords: '' }))
    const info = readInfo(two)
    expect(info.Title).toBe('Second')
    expect('Keywords' in info).toBe(false)
    expect(await pageTexts(setMetadata(one, {}))).toEqual(['A', 'B'])
  })
  test('PdfString values come back as text', async () => {
    const out = await PdfDocument.load(setMetadata(await PdfDocument.load(classicPdf(['A'])), { Subject: '日本語' }))
    const raw = out.resolve(out.trailer.get('Info'))
    expect(isDict(raw) && raw.get('Subject') instanceof PdfString).toBe(true)
    expect(readInfo(out).Subject).toBe('日本語')
  })
})
