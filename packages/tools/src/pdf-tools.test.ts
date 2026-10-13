import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { UserError, type FileData } from '@ream/core'
import { PdfDocument } from '@ream/pdf-core'
import { run as merge } from './merge-pdf/run.ts'
import { run as split } from './split-pdf/run.ts'

const fx = (name: string): FileData => ({
  name,
  type: 'application/pdf',
  bytes: new Uint8Array(readFileSync(join(import.meta.dirname, '../../pdf-core/test/fixtures', name))),
})
const ctx = { progress: () => {} }
const pages = async (f: FileData) => (await PdfDocument.load(f.bytes)).pages().length

describe('merge-pdf', () => {
  test('merges in the given order and reports progress up to 1', async () => {
    const seen: number[] = []
    const out = await merge([fx('chromium.pdf'), fx('cups.pdf')], {}, { progress: (p) => seen.push(p) })
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('merged.pdf')
    expect(await pages(out[0])).toBe(6)
    expect(seen.at(-1)).toBe(1)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  test('needs two files', async () => {
    await expect(merge([fx('cups.pdf')], {}, ctx)).rejects.toThrow('Add at least two PDFs')
  })

  test('a bad file is named in the error', async () => {
    const bad: FileData = { name: 'notes.pdf', type: 'application/pdf', bytes: new TextEncoder().encode('hello') }
    await expect(merge([fx('cups.pdf'), bad], {}, ctx)).rejects.toThrow("notes.pdf: This file isn't a PDF.")
    const enc: FileData = { ...bad, name: 'locked.pdf', bytes: new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt << >> >>\n') }
    await expect(merge([fx('cups.pdf'), enc], {}, ctx)).rejects.toBeInstanceOf(UserError)
  })
})

describe('split-pdf', () => {
  test('by ranges: one file per comma item, named after the input', async () => {
    const out = await split([fx('chromium.pdf')], { mode: 'ranges', ranges: '1-2,3', every: 1 }, ctx)
    expect(out.map((f) => f.name)).toEqual(['chromium-1.pdf', 'chromium-2.pdf'])
    expect(await Promise.all(out.map(pages))).toEqual([2, 1])
  })

  test('every N pages', async () => {
    const out = await split([fx('chromium.pdf')], { mode: 'every', ranges: '', every: 2 }, ctx)
    expect(await Promise.all(out.map(pages))).toEqual([2, 1])
  })

  test('range errors are user-readable', async () => {
    await expect(split([fx('cups.pdf')], { mode: 'ranges', ranges: '9', every: 1 }, ctx)).rejects.toThrow(
      "Page 9 doesn't exist; this PDF has 3 pages",
    )
    await expect(split([fx('cups.pdf')], { mode: 'ranges', ranges: '', every: 1 }, ctx)).rejects.toBeInstanceOf(UserError)
  })
})
