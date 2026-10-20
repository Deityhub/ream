import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfRangeError, PdfStream, decodeStream, extract, fillForm, merge, readForm, type FormField } from '../src/index.ts'
import { assemble, formPdf } from './helpers.ts'

const load = (b = formPdf()) => PdfDocument.load(b)
const byName = (fields: FormField[]) => Object.fromEntries(fields.map((f) => [f.name, f]))
const stream = async (doc: PdfDocument, ref: unknown) => new TextDecoder('latin1').decode(await decodeStream(doc.resolve(ref as never) as PdfStream))
/** the appearance stream of a widget by field name */
async function appearance(doc: PdfDocument, name: string) {
  const annots = doc.resolve(doc.pages()[0].dict.get('Annots')) as unknown[]
  for (const a of annots) {
    const d = doc.resolve(a as never) as Map<string, unknown>
    if (new TextDecoder().decode((doc.resolve(d.get('T') as never) as { bytes?: Uint8Array } | null)?.bytes ?? new Uint8Array()) === name) {
      const ap = doc.resolve(d.get('AP') as never) as Map<string, unknown>
      return stream(doc, ap.get('N'))
    }
  }
  throw new Error('no such widget ' + name)
}

describe('readForm', () => {
  test('every field with its kind, value, options, flags, page and place', async () => {
    const { fields, xfa } = readForm(await load())
    expect(xfa).toBe(false)
    expect(fields.map((f) => `${f.name}:${f.kind}`)).toEqual(['name:text', 'notes:text', 'code:text', 'agree:checkbox', 'size:radio', 'country:choice', 'sig:signature'])
    const f = byName(fields)
    expect(f.name.value).toBe('Ann')
    expect(f.notes.multiline).toBe(true)
    expect(f.code).toMatchObject({ comb: true, maxLength: 4 })
    expect(f.agree.value).toBe(false)
    expect(f.size.options).toEqual([{ value: 'S', label: 'S' }, { value: 'L', label: 'L' }])
    expect(f.size.value).toBe('')
    expect(f.country).toMatchObject({ combo: true, options: [{ value: 'France', label: 'France' }, { value: 'Germany', label: 'Germany' }, { value: 'it', label: 'Italy' }] })
    expect(f.name).toMatchObject({ page: 0, rect: [20, 340, 200, 360], unsupported: false })
    expect(f.sig.unsupported).toBe(true)
  })

  test('every widget of a field, as a box on the page as displayed, with the state it stands for', async () => {
    const f = byName(readForm(await load()).fields)
    // the page is 300 x 400: the name field at [20 340 200 360] sits near the top
    expect(f.name.widgets).toEqual([{ page: 0, box: { x: 20 / 300, y: 40 / 400, w: 180 / 300, h: 20 / 400 }, state: null }])
    expect(f.size.widgets.map((w) => w.state)).toEqual(['S', 'L'])
    expect(f.size.widgets.every((w) => w.page === 0 && w.box !== null)).toBe(true)
  })

  test('boxes follow the page rotation; values inherited from a parent field are read', async () => {
    const doc = await PdfDocument.load(
      assemble([
        [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> >>'],
        [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
        [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Rotate 90 /Annots [6 0 R] >>'],
        [5, '<< /FT /Tx /T (parent) /V (From the parent) /Kids [6 0 R] >>'],
        [6, '<< /Type /Annot /Subtype /Widget /Parent 5 0 R /Rect [0 0 50 20] /P 3 0 R >>'],
      ]).bytes,
    )
    const [field] = readForm(doc).fields
    expect(field.value).toBe('From the parent')
    // turned a quarter clockwise: user x runs down the displayed page, user y across it (displayed 100 wide, 200 tall)
    expect(field.widgets[0].box).toEqual({ x: 0, y: 0, w: 0.2, h: 0.25 })
  })

  test('a form that lists one copy of a field while the page shows another fills the one on the page', async () => {
    const doc = await PdfDocument.load(
      assemble([
        [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /DA (/Helv 0 Tf 0 g) >> >>'],
        [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
        [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Annots [6 0 R 7 0 R] >>'],
        [5, '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (old copy) /Rect [0 0 50 20] >>'],
        [6, '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /V (shown) /Rect [0 0 50 20] /P 3 0 R >>'],
        [7, '<< /Type /Annot /Subtype /Widget /FT /Tx /T (extra) /Rect [60 0 110 20] /P 3 0 R >>'],
      ]).bytes,
    )
    const f = byName(readForm(doc).fields)
    expect(f.name).toMatchObject({ value: 'shown', page: 0 })
    expect(f.extra.page).toBe(0)
    const out = await load(await fillForm(doc, { name: 'new', extra: 'x' }))
    expect(byName(readForm(out).fields).name.value).toBe('new')
    const fields = (out.resolve((out.resolve(out.catalog().get('AcroForm')) as Map<string, never>).get('Fields')) as { num: number }[]).map((r) => r.num)
    const annots = (out.resolve(out.pages()[0].dict.get('Annots')) as { num: number }[]).map((r) => r.num)
    expect(fields.sort()).toEqual(annots.sort())
  })

  test('a file without a form, and an XFA form, are reported', async () => {
    const plain = await PdfDocument.load((await import('./helpers.ts')).classicPdf(['x']))
    expect(readForm(plain)).toEqual({ fields: [], xfa: false })
    expect(readForm(await load(formPdf('/XFA [(a) 5 0 R]'))).xfa).toBe(true)
  })
})

describe('fillForm', () => {
  test('a text longer than the field allows, and a choice that is not offered, are refused', async () => {
    await expect(fillForm(await load(), { code: '12345' })).rejects.toThrow(/at most 4 characters/)
    await expect(fillForm(await load(), { country: 'Spain' })).rejects.toThrow(/not one of the choices/)
    // clearing a choice is fine
    expect(byName(readForm(await load(await fillForm(await load(), { country: '' }))).fields).country.value).toBe('')
  })

  test('values are saved and read back, and the text shows in the field', async () => {
    const out = await fillForm(await load(), { name: 'Jean Dupont', notes: 'First line\nSecond line', code: '1234', country: 'it' })
    const doc = await load(out)
    const f = byName(readForm(doc).fields)
    expect(f.name.value).toBe('Jean Dupont')
    expect(f.notes.value).toBe('First line\nSecond line')
    expect(f.country.value).toBe('it')
    expect(f.agree.value).toBe(false)
    // the picture holds the text as glyph codes
    expect(await appearance(doc, 'name')).toContain('<4a65616e20447570' + '6f6e74>')
    const comb = await appearance(doc, 'code')
    expect(comb.match(/<3[1-4]> Tj/g)).toHaveLength(4) // one placed glyph per cell
    expect((await appearance(doc, 'notes')).match(/ Tj/g)).toHaveLength(2)
    // viewers needn't redraw the form any more
    expect((doc.resolve(doc.catalog().get('AcroForm')) as Map<string, unknown>).has('NeedAppearances')).toBe(false)
  })

  test('check boxes and radio buttons switch state', async () => {
    const out = await fillForm(await load(), { agree: true, size: 'L' })
    const doc = await load(out)
    const f = byName(readForm(doc).fields)
    expect(f.agree.value).toBe(true)
    expect(f.size.value).toBe('L')
    const annots = (doc.resolve(doc.pages()[0].dict.get('Annots')) as unknown[]).map((a) => doc.resolve(a as never) as Map<string, { value?: string }>)
    const states = annots.filter((d) => d.has('AS')).map((d) => d.get('AS')!.value)
    expect(states).toEqual(['Yes', 'Off', 'L']) // check box on, radio S off, radio L on
    const off = await fillForm(doc, { agree: false, size: '' })
    expect(byName(readForm(await load(off)).fields).agree.value).toBe(false)
    expect(byName(readForm(await load(off)).fields).size.value).toBe('')
  })

  test('other fields keep their values and a field not touched keeps what it showed', async () => {
    const out = await fillForm(await load(), { notes: 'x' })
    const f = byName(readForm(await load(out)).fields)
    expect(f.name.value).toBe('Ann')
    expect(f.notes.value).toBe('x')
  })

  test('mistakes are explained', async () => {
    const doc = await load()
    await expect(fillForm(doc, { nope: 'x' })).rejects.toThrow('no field named "nope"')
    await expect(fillForm(doc, { size: 'XL' })).rejects.toThrow('not one of the choices')
    await expect(fillForm(doc, { name: 'Zażółć' })).rejects.toBeInstanceOf(PdfRangeError)
    await expect(fillForm(doc, { name: 'Zażółć' })).rejects.toThrow(/"name"/)
  })

  test('the rest of the file stays: pages, other widgets and the catalog', async () => {
    const doc = await load(await fillForm(await load(), { name: 'x' }))
    expect(doc.pages().length).toBe(1)
    expect((doc.resolve(doc.pages()[0].dict.get('Annots')) as unknown[]).length).toBe(8)
    expect(readForm(doc).fields.length).toBe(7)
  })
})

describe('form fields through the page tools', () => {
  // page A has text field "a" and radio button S; page B has text field "b" and radio button L of the same group "size"
  const twoPages = () => {
    const w = (page: number, rect: string, rest: string) => `<< /Type /Annot /Subtype /Widget /Rect [${rect}] /P ${page} 0 R ${rest} >>`
    const stream = '<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length 0 >>\nstream\n\nendstream'
    return assemble([
      [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [10 0 R 11 0 R 14 0 R] /DR << /Font << /Helv 3 0 R >> >> /DA (/Helv 0 Tf 0 g) >> >>'],
      [2, '<< /Type /Pages /Kids [4 0 R 5 0 R] /Count 2 >>'],
      [3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
      [4, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [10 0 R 15 0 R] >>'],
      [5, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [11 0 R 16 0 R] >>'],
      [10, w(4, '10 10 100 30', '/FT /Tx /T (a) /V (one) /DA (/Helv 12 Tf 0 g)')],
      [11, w(5, '10 10 100 30', '/FT /Tx /T (b) /V (two) /DA (/Helv 12 Tf 0 g)')],
      [14, '<< /FT /Btn /Ff 32768 /T (size) /V /S /Kids [15 0 R 16 0 R] >>'],
      [15, w(4, '10 50 30 70', '/Parent 14 0 R /AS /S /AP << /N << /S 20 0 R /Off 20 0 R >> >>')],
      [16, w(5, '10 50 30 70', '/Parent 14 0 R /AS /Off /AP << /N << /L 20 0 R /Off 20 0 R >> >>')],
      [20, stream],
    ]).bytes
  }
  const names = async (b: Uint8Array) => readForm(await PdfDocument.load(b)).fields.map((f) => `${f.name}:${f.page}`)

  test('extracting a page keeps its fields and drops the others', async () => {
    const doc = await PdfDocument.load(twoPages())
    expect(await names(extract(doc, [0]))).toEqual(['a:0', 'size:0'])
    expect(await names(extract(doc, [1]))).toEqual(['b:0', 'size:0'])
    const second = readForm(await PdfDocument.load(extract(doc, [1])))
    expect(second.fields.find((f) => f.name === 'size')!.options).toEqual([{ value: 'L', label: 'L' }]) // only the button that is on this page
    expect(second.fields.find((f) => f.name === 'b')!.value).toBe('two')
  })

  test('reordered pages keep every field; values survive', async () => {
    const doc = await PdfDocument.load(twoPages())
    const out = extract(doc, [1, 0])
    expect(await names(out)).toEqual(['a:1', 'b:0', 'size:1']) // size starts on the page that is now second
    const f = Object.fromEntries(readForm(await PdfDocument.load(out)).fields.map((x) => [x.name, x.value]))
    expect(f).toEqual({ a: 'one', b: 'two', size: 'S' })
  })

  test('a merged file has the fields of every part and the form defaults, and fills like any form', async () => {
    const a = await PdfDocument.load(twoPages())
    const merged = merge([{ doc: a, pages: [0] }, { doc: await PdfDocument.load(formPdf()), pages: [0] }])
    const names2 = readForm(await PdfDocument.load(merged)).fields.map((f) => f.name)
    expect(names2).toEqual(['a', 'size', 'name', 'notes', 'code', 'agree', 'size', 'country', 'sig'])
    const out = await fillForm(await PdfDocument.load(merged), { a: 'changed', name: 'Zed' })
    const f = Object.fromEntries(readForm(await PdfDocument.load(out)).fields.map((x) => [x.name, x.value]))
    expect(f.a).toBe('changed')
    expect(f.name).toBe('Zed')
  })

  test('pages without form fields leave no form behind', async () => {
    const doc = await PdfDocument.load(twoPages())
    const out = await PdfDocument.load(extract(doc, [0]))
    expect(out.catalog().has('AcroForm')).toBe(true)
    const plain = await PdfDocument.load((await import('./helpers.ts')).classicPdf(['x']))
    expect((await PdfDocument.load(extract(plain, [0]))).catalog().has('AcroForm')).toBe(false)
  })
})
