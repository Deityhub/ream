import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { FileData } from '@ream/core'
import { PdfDocument, readForm } from '@ream/pdf-core'
import { formPdf } from '../../pdf-core/test/helpers.ts'
import { extractText } from '@ream/pdf-render'
import { fakePlatform } from '../../pdf-render/test/helpers.ts'
import { run as redact } from './redact-pdf/run.ts'
import { defaultOptions as redactDefaults } from './redact-pdf/areas.ts'
import { run as fill } from './fill-pdf-form/run.ts'
import { unwritable } from './fill-pdf-form/values.ts'

const ctx = { progress: () => {} }
const chromium: FileData = { name: 'chromium.pdf', type: 'application/pdf', bytes: new Uint8Array(readFileSync(new URL('../../pdf-core/test/fixtures/chromium.pdf', import.meta.url))) }
const pages = async (f: FileData) => {
  const doc = await PdfDocument.load(f.bytes)
  return extractText(doc, doc.pages().map((_, i) => i), { markdown: false })
}

describe('redact-pdf', () => {
  const title = { x: 0, y: 0.04, w: 1, h: 0.035 }
  const platform = fakePlatform().platform

  test('one page: the marked text is gone from the file, the rest of the page and the other pages stay', async () => {
    const [out] = await redact([chromium], { ...redactDefaults, areasByPage: { 0: [title] } }, ctx, platform)
    expect(out.name).toBe('chromium-redacted.pdf')
    const [p1, p2] = await pages(out)
    expect(p1).not.toContain('Chromium page 1')
    expect(p1).toContain('Café résumé')
    expect(p2).toContain('Chromium page 2')
  })

  test('all pages: the same areas everywhere', async () => {
    const [out] = await redact([chromium], { ...redactDefaults, scope: 'all', areas: [title] }, ctx, platform)
    const texts = await pages(out)
    expect(texts.every((t) => !/Chromium page/.test(t) && t.includes('Café'))).toBe(true)
  })

  test('nothing marked is a clear error', async () => {
    await expect(redact([chromium], redactDefaults, ctx, platform)).rejects.toThrow(/mark what to redact/)
  })
})

describe('fill-pdf-form', () => {
  const form: FileData = { name: 'form.pdf', type: 'application/pdf', bytes: formPdf() }
  const fields = async (f: FileData) => Object.fromEntries(readForm(await PdfDocument.load(f.bytes)).fields.map((x) => [x.name, x.value]))

  test('changed fields are filled; the values already in the file stay', async () => {
    const [out] = await fill([form], { values: { notes: 'Two\nlines', agree: true, size: 'L', country: 'it' }, lock: false }, ctx)
    expect(out.name).toBe('form-filled.pdf')
    expect(await fields(out)).toMatchObject({ name: 'Ann', notes: 'Two\nlines', agree: true, size: 'L', country: 'it' })
    // and the filled file can be filled again, changing what was there
    const [again] = await fill([out], { values: { name: 'Bea', agree: false }, lock: false }, ctx)
    expect(await fields(again)).toMatchObject({ name: 'Bea', agree: false, size: 'L' })
  })

  test('locked: the answers are part of the pages and the form has no fields left', async () => {
    const [out] = await fill([form], { values: { name: 'Locked in' }, lock: true }, ctx)
    const doc = await PdfDocument.load(out.bytes)
    expect(readForm(doc).fields).toEqual([])
    expect((await extractText(doc, [0], { markdown: false }))[0]).toContain('Locked in')
  })

  test('letters the form font cannot show, files without fields and XFA forms get clear messages', async () => {
    expect(unwritable('Café Łódź € Łx')).toEqual(['Ł', 'ź'])
    await expect(fill([form], { values: { name: 'Łukasz' }, lock: false }, ctx)).rejects.toThrow(/can't show Ł/)
    await expect(fill([chromium], { values: {}, lock: false }, ctx)).rejects.toThrow(/no form fields/)
    await expect(fill([{ ...form, bytes: formPdf('/XFA [(a) 5 0 R]') }], { values: {}, lock: false }, ctx)).resolves.toHaveLength(1)
  })
})
