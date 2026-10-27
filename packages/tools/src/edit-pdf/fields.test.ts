import { describe, expect, test } from 'vitest'
import { PdfDocument, readForm } from '@ream/pdf-core'
import { formPdf } from '../../../pdf-core/test/helpers.ts'
import { nodeFonts } from '../fonts/node.ts'
import { byPosition, copiedField, fieldItems, formEdits, joinGroup, newField } from './fields.ts'
import { run } from './run.ts'
import { defaultOptions, type FieldItem } from './items.ts'

const sizes = [{ width: 300, height: 400 }]
let n = 0
const id = () => `f${n++}`
const loaded = async () => fieldItems(readForm(await PdfDocument.load(formPdf())), id)
const opts = (items: FieldItem[], fieldsLoaded: FieldItem[], tabOrder = {}) => ({ items, fieldsLoaded, tabOrder })

describe('edit-pdf: form fields', () => {
  test("the file's fields become one item per widget, and nothing changed means nothing to do", async () => {
    const items = await loaded()
    expect(items.map((i) => `${i.name}:${i.type}`)).toEqual(['name:text', 'notes:text', 'code:text', 'agree:checkbox', 'size:radio', 'size:radio', 'country:dropdown', 'sig:signature'])
    expect(items.find((i) => i.name === 'size')!.state).toBe('S')
    expect(formEdits(opts(items, items), sizes)).toBeNull()
  })

  test('a move is a change that keeps the pictures; a new setting redraws them; a deleted field is removed', async () => {
    const was = await loaded()
    const items = was
      .filter((i) => i.name !== 'notes')
      .map((i) => (i.name === 'name' ? { ...i, box: { ...i.box, x: i.box.x + 0.1 } } : i.name === 'code' ? { ...i, fontSize: 9 } : i))
    const e = formEdits(opts(items, was), sizes)!
    expect(e.remove).toEqual(['notes'])
    expect(e.change!.map((c) => [c.was, c.redraw])).toEqual([['name', false], ['code', true]])
    const name = e.change![0]
    // 20 340 200 360 in the file, moved by a tenth of the 300 point page
    expect(name.widgets[0].rect.map((v) => Math.round(v))).toEqual([50, 340, 230, 360])
    expect(name.widgets[0].from).toBe(0)
  })

  test('new fields, radio buttons joining a group, copies with names of their own, and the Tab order', async () => {
    const was = await loaded()
    const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.05 }
    const text = newField(id(), 0, 'text', box, was, null)
    expect(text.name).toBe('Text 1')
    const radio = newField(id(), 0, 'radio', box, was, was.find((i) => i.name === 'size')!)
    expect([radio.name, radio.state, radio.source]).toEqual(['size', 'Choice 3', undefined])
    const copy = copiedField(text, id(), [...was, text])
    expect(copy.name).toBe('Text 2')
    const items = [...was, text, radio, copy]
    const order = [text.id, was[0].id]
    const e = formEdits(opts(items, was, { 0: order }), sizes)!
    expect(e.add!.map((f) => f.name)).toEqual(['Text 1', 'Text 2'])
    expect(e.change!.map((c) => c.was)).toEqual(['size'])
    expect(e.change![0].widgets.map((w) => [w.state, w.from])).toEqual([['S', 0], ['L', 1], ['Choice 3', undefined]])
    expect(e.order!.get(0)).toEqual([{ name: 'Text 1', widget: 0 }, { name: 'name', widget: 0 }])
  })

  test('saving writes the fields: added, changed and removed', async () => {
    const was = await loaded()
    const add = newField(id(), 0, 'checkbox', { x: 0.5, y: 0.5, w: 0.05, h: 0.04 }, was, null)
    const items = [...was.filter((i) => i.name !== 'sig').map((i) => (i.name === 'name' ? { ...i, name: 'full', tooltip: 'Your name' } : i)), add]
    const [out] = await run([{ name: 'f.pdf', type: 'application/pdf', bytes: formPdf() }], { ...defaultOptions, items, fieldsLoaded: was }, { progress: () => {} }, nodeFonts)
    const fields = readForm(await PdfDocument.load(out.bytes)).fields
    expect(fields.map((f) => f.name)).toEqual(['full', 'notes', 'code', 'agree', 'size', 'country', 'Checkbox 1'])
    expect(fields[0]).toMatchObject({ tooltip: 'Your name', value: 'Ann' })
  })

  test('a radio button moves into another group, or one of its own, and the file is written so', async () => {
    const was = await loaded()
    const box = { x: 0.6, y: 0.5, w: 0.05, h: 0.04 }
    const lone = newField(id(), 0, 'radio', box, was, null)
    // into the file's "size" group: its settings, and a value no button there has
    let items = joinGroup([...was, lone], lone.id, 'size')
    const moved = items.find((i) => i.id === lone.id) as FieldItem
    expect([moved.name, moved.state]).toEqual(['size', 'Choice 1'])
    // the file's first "size" button into a group of its own: the old group keeps its other button
    const first = was.find((i) => i.name === 'size')!
    items = joinGroup(items, first.id, null)
    const own = items.find((i) => i.id === first.id) as FieldItem
    expect(own.name).not.toBe('size')
    expect(own.source).toBeUndefined()
    const [out] = await run([{ name: 'f.pdf', type: 'application/pdf', bytes: formPdf() }], { ...defaultOptions, items, fieldsLoaded: was }, { progress: () => {} }, nodeFonts)
    const f = Object.fromEntries(readForm(await PdfDocument.load(out.bytes)).fields.map((x) => [x.name, x]))
    expect(f.size.options.map((o) => o.value)).toEqual(['L', 'Choice 1'])
    expect(f[own.name]).toMatchObject({ kind: 'radio', options: [{ value: 'S' }] })
  })

  test('reading order is by rows, then left to right', () => {
    const at = (x: number, y: number) => ({ box: { x, y, w: 0.1, h: 0.04 } }) as FieldItem
    const [a, b, c] = [at(0.5, 0.1), at(0.1, 0.11), at(0.1, 0.3)]
    expect(byPosition([c, a, b])).toEqual([b, a, c])
  })
})
