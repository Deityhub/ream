import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfRangeError, PdfRef, editForm, fillForm, readForm, type FieldSpec, type FormField } from '../src/index.ts'
import { assemble, classicPdf, formPdf } from './helpers.ts'

const spec = (o: Partial<FieldSpec> & Pick<FieldSpec, 'name' | 'type' | 'widgets'>): FieldSpec => ({
  value: '',
  tooltip: '',
  required: false,
  readOnly: false,
  multiline: false,
  password: false,
  comb: false,
  maxLength: null,
  fontSize: 0,
  align: 0,
  textColour: [0, 0, 0],
  border: [0, 0, 0],
  borderWidth: 1,
  background: null,
  options: [],
  editable: false,
  dateFormat: '',
  ...o,
})
const byName = (fields: FormField[]) => Object.fromEntries(fields.map((f) => [f.name, f]))
const again = async (bytes: Uint8Array) => PdfDocument.load(bytes)
const annotNames = (doc: PdfDocument, page = 0) =>
  (doc.resolve(doc.pages()[page].dict.get('Annots')) as unknown[]).map((a) => {
    const d = doc.resolve(a as never) as Map<string, unknown>
    const t = doc.resolve((d.get('T') ?? (doc.resolve(d.get('Parent') as never) as Map<string, unknown>).get('T')) as never) as { bytes: Uint8Array }
    return new TextDecoder().decode(t.bytes)
  })

describe('editForm', () => {
  test('adds a field of every kind to a file without a form, read back as it was given', async () => {
    const doc = await PdfDocument.load(classicPdf(['hello']))
    const [W, H] = (() => {
      const s = doc.pageSize(doc.pages()[0])
      return [s.width, s.height]
    })()
    const out = await editForm(doc, {
      add: [
        spec({ name: 'who', type: 'text', widgets: [{ page: 0, rect: [50, H - 100, 250, H - 80] }], value: 'Ann', tooltip: 'Your name', required: true, maxLength: 20 }),
        spec({ name: 'when', type: 'date', widgets: [{ page: 0, rect: [50, H - 140, 150, H - 120] }], dateFormat: 'dd/mm/yyyy' }),
        spec({ name: 'ok', type: 'checkbox', widgets: [{ page: 0, rect: [50, H - 170, 62, H - 158] }], value: true }),
        spec({ name: 'size', type: 'radio', widgets: [{ page: 0, rect: [80, H - 170, 92, H - 158], state: 'S' }, { page: 0, rect: [100, H - 170, 112, H - 158], state: 'L' }], value: 'L' }),
        spec({ name: 'land', type: 'dropdown', widgets: [{ page: 0, rect: [50, H - 200, 200, H - 180] }], options: [{ value: 'fr', label: 'France' }, { value: 'Spain', label: 'Spain' }], value: 'fr', editable: true }),
        spec({ name: 'pick', type: 'list', widgets: [{ page: 0, rect: [50, H - 260, 200, H - 210] }], options: [{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }] }),
        spec({ name: 'sign', type: 'signature', widgets: [{ page: 0, rect: [50, H - 320, 200, H - 280] }] }),
      ],
    })
    const f = byName(readForm(await again(out)).fields)
    expect(Object.keys(f)).toEqual(['who', 'when', 'ok', 'size', 'land', 'pick', 'sign'])
    expect(f.who).toMatchObject({ kind: 'text', value: 'Ann', tooltip: 'Your name', required: true, maxLength: 20, page: 0, border: [0, 0, 0] })
    expect(f.who.widgets[0].box!.x).toBeCloseTo(50 / W)
    expect(f.who.widgets[0].box!.y).toBeCloseTo(80 / H)
    expect(f.when).toMatchObject({ kind: 'text', dateFormat: 'dd/mm/yyyy' })
    expect(f.ok).toMatchObject({ kind: 'checkbox', value: true })
    expect(f.size).toMatchObject({ kind: 'radio', value: 'L', options: [{ value: 'S' }, { value: 'L' }] })
    expect(f.land).toMatchObject({ kind: 'choice', combo: true, editable: true, value: 'fr', options: [{ value: 'fr', label: 'France' }, { value: 'Spain', label: 'Spain' }] })
    expect(f.pick).toMatchObject({ kind: 'choice', combo: false })
    expect(f.sign.kind).toBe('signature')
    // and it fills like any form
    const filled = byName(readForm(await again(await fillForm(await again(out), { who: 'Bo', size: 'S', ok: false }))).fields)
    expect(filled.who.value).toBe('Bo')
    expect(filled.size.value).toBe('S')
    expect(filled.ok.value).toBe(false)
  })

  test('changes, renames, moves and removes fields, leaving the others as they were', async () => {
    const doc = await PdfDocument.load(formPdf())
    const before = byName(readForm(doc).fields)
    const name = before.name
    const out = await editForm(doc, {
      change: [
        {
          ...spec({ name: 'fullname', type: 'text', widgets: [{ page: 0, rect: [30, 40, 210, 60], from: 0 }], value: 'Cleo', tooltip: 'Full name', fontSize: 10 }),
          was: 'name',
          redraw: true,
        },
        {
          // a third button, and a button that stands for another value now
          ...spec({ name: 'size', type: 'radio', widgets: [{ page: 0, rect: [60, 170, 80, 190], state: 'Small', from: 0 }, { page: 0, rect: [100, 170, 120, 190], state: 'L', from: 1 }, { page: 0, rect: [140, 170, 160, 190], state: 'XL' }], value: 'XL' }),
          was: 'size',
          redraw: false,
        },
      ],
      remove: ['notes'],
    })
    const after = readForm(await again(out)).fields
    const f = byName(after)
    expect(after.map((x) => x.name)).toEqual(['fullname', 'code', 'agree', 'size', 'country', 'sig'])
    expect(f.fullname).toMatchObject({ value: 'Cleo', tooltip: 'Full name', fontSize: 10, rect: [30, 40, 210, 60] })
    expect(f.size.options.map((o) => o.value)).toEqual(['Small', 'L', 'XL'])
    expect(f.size.value).toBe('XL')
    expect(f.code).toEqual(before.code)
    expect(f.country).toEqual(before.country)
    expect(name.rect).toEqual([20, 340, 200, 360])
    expect(annotNames(await again(out))).not.toContain('notes')
  })

  test('sets the order Tab goes through the fields on a page', async () => {
    const doc = await PdfDocument.load(formPdf())
    const out = await editForm(doc, { order: new Map([[0, [{ name: 'country', widget: 0 }, { name: 'code', widget: 0 }, { name: 'name', widget: 0 }]]]) })
    const names = annotNames(await again(out))
    expect(names.indexOf('country')).toBeLessThan(names.indexOf('code'))
    expect(names.indexOf('code')).toBeLessThan(names.indexOf('name'))
    // the others keep their places
    expect(names.length).toBe(8)
  })

  test('a field on a turned page sits where it was drawn, its picture turned with the page', async () => {
    const bytes = assemble([
      [1, '<< /Type /Catalog /Pages 2 0 R >>'],
      [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
      [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Rotate 90 >>'],
    ]).bytes
    const doc = await PdfDocument.load(bytes)
    // displayed, the page is 100 wide and 200 tall
    const out = await editForm(doc, { add: [spec({ name: 'a', type: 'text', widgets: [{ page: 0, rect: [10, 150, 90, 170] }], value: 'x' })] })
    const back = await again(out)
    const f = readForm(back).fields[0]
    expect(f.widgets[0].box!.x).toBeCloseTo(0.1)
    expect(f.widgets[0].box!.y).toBeCloseTo(30 / 200)
    expect(f.widgets[0].box!.w).toBeCloseTo(0.8)
    expect(f.widgets[0].box!.h).toBeCloseTo(20 / 200)
    const annot = back.resolve((back.resolve(back.pages()[0].dict.get('Annots')) as PdfRef[])[0]) as Map<string, unknown>
    expect((back.resolve(annot.get('MK') as never) as Map<string, unknown>).get('R')).toBe(90)
    const ap = back.resolve((back.resolve(annot.get('AP') as never) as Map<string, unknown>).get('N') as never) as { dict: Map<string, unknown> }
    expect(ap.dict.get('BBox')).toEqual([0, 0, 80, 20])
    expect(ap.dict.get('Matrix')).toEqual([0, 1, -1, 0, 20, 0])
  })

  test('refuses what a form can not hold, naming the field', async () => {
    const doc = await PdfDocument.load(formPdf())
    const at = { page: 0, rect: [10, 10, 50, 30] as [number, number, number, number] }
    await expect(editForm(doc, { add: [spec({ name: 'code', type: 'text', widgets: [at] })] })).rejects.toThrow(/two fields named "code"/)
    await expect(editForm(doc, { add: [spec({ name: 'a.b', type: 'text', widgets: [at] })] })).rejects.toThrow(/dot/)
    await expect(editForm(doc, { change: [{ ...spec({ name: 'code', type: 'checkbox', widgets: [{ ...at, from: 0 }] }), was: 'code', redraw: true }] })).rejects.toThrow(/another kind/)
    await expect(editForm(doc, { add: [spec({ name: 'z', type: 'text', widgets: [at], value: '日本' })] })).rejects.toThrow(PdfRangeError)
    await expect(editForm(doc, { remove: ['nope'] })).rejects.toThrow(/no field named "nope"/)
  })
})
