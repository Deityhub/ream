import { expect, test } from 'vitest'
import { PdfDocument, PdfStream, PdfDrawing, buildPdf, decodeStream, isDict, measure, prepareFont } from '../src/index.ts'
import { makeTtf } from './ttf-helper.ts'

const dec = new TextDecoder('latin1')
const contentOf = async (doc: PdfDocument, i: number) => {
  const c = doc.resolve(doc.pages()[i].dict.get('Contents'))
  return c instanceof PdfStream ? dec.decode(await decodeStream(c)) : ''
}
const fontNames = (doc: PdfDocument, i: number) => {
  const res = doc.resolve(doc.pages()[i].dict.get('Resources'))
  const fonts = isDict(res) ? doc.resolve(res.get('Font')) : null
  return isDict(fonts) ? [...fonts.values()].map((f) => { const d = doc.resolve(f); return isDict(d) ? String((doc.resolve(d.get('BaseFont')) as { value: string }).value) : '' }).sort() : []
}

test('pages, sizes, y flipped to PDF space, fonts by family and style, clipping balanced', async () => {
  const d = new PdfDrawing()
  d.title = 'Résumé'
  const a = d.addPage(200, 100)
  a.fillRect(10, 10, 50, 20, [255, 0, 0])
  a.line(0, 50, 200, 50, 0.5, [0, 0, 0], [2, 1])
  a.save()
  a.clip(10, 10, 80, 20) // left open on purpose: build closes it
  a.text(12, 25, 'Hello (world)', { family: 'sans', bold: true }, 12, [0, 0, 255])
  const b = d.addPage(300, 400)
  b.text(20, 40, 'Serif', { family: 'serif', italic: true }, 10, [0, 0, 0])
  b.text(20, 60, 'Mono', { family: 'mono' }, 10, [0, 0, 0])
  const { bytes, lost } = await buildPdf(d)
  expect(lost).toEqual([])
  const doc = await PdfDocument.load(bytes)
  expect(doc.pages()).toHaveLength(2)
  expect([doc.pageSize(doc.pages()[0]), doc.pageSize(doc.pages()[1])]).toEqual([{ width: 200, height: 100 }, { width: 300, height: 400 }])
  const c = await contentOf(doc, 0)
  expect(c).toContain('1 0 0 rg 10 70 50 20 re f') // 100 - 10 - 20
  expect(c).toContain('[2 1] 0 d 0 50 m 200 50 l S')
  expect(c).toContain('10 70 80 20 re W n')
  expect(c).toContain('12 75 Td') // baseline 25 from the top
  expect((c.match(/\bq\b/g) ?? []).length).toBe((c.match(/\bQ\b/g) ?? []).length)
  expect(fontNames(doc, 0)).toEqual(['Helvetica-Bold'])
  expect(fontNames(doc, 1)).toEqual(['Courier', 'Times-Italic'])
})

test('characters the standard fonts lack become ? and are reported once', async () => {
  const d = new PdfDrawing()
  d.addPage(100, 100).text(5, 20, 'aЖb Ж→', { family: 'sans' }, 10, [0, 0, 0])
  const { bytes, lost } = await buildPdf(d)
  expect(lost.sort()).toEqual(['Ж', '→'])
  expect(await contentOf(await PdfDocument.load(bytes), 0)).toContain('<613f62203f3f>') // a?b ??
})

test('a custom font is embedded once, used for custom text, and measured with its own widths', async () => {
  const ttf = makeTtf()
  const d = new PdfDrawing()
  d.addPage(100, 100).text(5, 20, 'AЖ', { family: 'custom' }, 10, [0, 0, 0])
  d.addPage(100, 100).text(5, 20, 'A', { family: 'custom' }, 10, [0, 0, 0])
  const font = await prepareFont(ttf, d.customText())
  const { bytes } = await buildPdf(d, font)
  const doc = await PdfDocument.load(bytes)
  expect(fontNames(doc, 0)[0]).toMatch(/^[A-Z]{6}\+/)
  expect(await contentOf(doc, 1)).toContain('<0002> Tj')
  expect(measure('AЖ', 10, { family: 'custom' }, font)).toBeCloseTo((600 + 700) / 100, 5)
})

test('pictures: one object however many pages draw it', async () => {
  const d = new PdfDrawing()
  const id = d.addImage({ width: 2, height: 1, rgba: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 128]) })
  d.addPage(100, 100).image(id, 10, 10, 40, 20)
  d.addPage(100, 100).image(id, 0, 0, 100, 50)
  const doc = await PdfDocument.load((await buildPdf(d)).bytes)
  const xo = (i: number) => { const r = doc.resolve(doc.pages()[i].dict.get('Resources')); return isDict(r) ? doc.resolve(r.get('XObject')) : null }
  const [x0, x1] = [xo(0), xo(1)]
  expect(isDict(x0) && isDict(x1) && x0.get('Im0')).toEqual(isDict(x1) ? x1.get('Im0') : null)
  expect(await contentOf(doc, 0)).toContain('40 0 0 20 10 70 cm /Im0 Do')
})

test('measure: Helvetica exact, Courier fixed, Times a little narrower; refuses bad sizes and empty documents', async () => {
  expect(measure('Hello', 10, { family: 'sans' })).toBeCloseTo(((722 + 556 + 222 + 222 + 556) * 10) / 1000, 5)
  expect(measure('abcd', 10, { family: 'mono' })).toBe(24)
  expect(measure('Hello', 10, { family: 'serif' })).toBeLessThan(measure('Hello', 10, { family: 'sans' }))
  expect(() => new PdfDrawing().addPage(0, 10)).toThrow(/size/)
  await expect(buildPdf(new PdfDrawing())).rejects.toThrow(/nothing/)
})

test('paths in page space, turning about a centre, transparency as a graphics state, narrowed glyphs', async () => {
  const d = new PdfDrawing()
  const p = d.addPage(200, 100)
  p.path([['M', 10, 10], ['L', 60, 10], ['C', 70, 10, 70, 30, 60, 30], ['Z']], { fill: [0, 128, 0], fillAlpha: 0.5, stroke: [255, 0, 0], width: 2, dash: [3, 1] })
  p.save()
  p.rotate(90, 100, 50) // a quarter turn clockwise about the middle of the page
  p.text(100, 50, 'Hi', { family: 'sans', scale: 0.5 }, 10, [0, 0, 0])
  p.restore()
  const { bytes } = await buildPdf(d)
  const doc = await PdfDocument.load(bytes)
  const c = await contentOf(doc, 0)
  expect(c).toContain('10 90 m 60 90 l 70 90 70 70 60 70 c h B') // y flipped: 100 - 10, 100 - 30
  expect(c).toContain('[3 1] 0 d')
  expect(c).toMatch(/\/Ream0 gs 0 0.502 0 rg/)
  // 90 degrees clockwise: a=0 b=-1 c=1 d=0; the page point (100, 50) -> PDF (100, 50) stays where it is
  expect(c).toContain('0 -1 1 0 50 150 cm')
  expect(c).toContain('50 Tz')
  const res = doc.resolve(doc.pages()[0].dict.get('Resources'))
  const gs = isDict(res) ? doc.resolve(res.get('ExtGState')) : null
  expect(isDict(gs) && [...gs.keys()]).toEqual(['Ream0'])
  expect(measure('Hi', 10, { family: 'sans', scale: 0.5 })).toBeCloseTo(measure('Hi', 10, { family: 'sans' }) / 2, 6)
})
