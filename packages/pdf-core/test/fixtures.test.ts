import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { PdfDocument, extract, merge, remove, rotate, split } from '../src/index.ts'

// real files from real producers (Chromium/Skia, macOS Quartz); add more PDFs to test/fixtures to widen coverage
const dir = join(import.meta.dirname, 'fixtures')
const files = readdirSync(dir).filter((f) => f.endsWith('.pdf'))

test('fixtures exist', () => expect(files.length).toBeGreaterThanOrEqual(2))

describe.each(files)('%s', (file) => {
  const load = () => PdfDocument.load(new Uint8Array(readFileSync(join(dir, file))))

  test('every op output re-loads with the right page count', async () => {
    const doc = await load()
    const n = doc.pages().length
    expect(n).toBeGreaterThan(0)
    const count = async (b: Uint8Array) => (await PdfDocument.load(b)).pages().length
    expect(await count(merge([{ doc }, { doc }]))).toBe(n * 2)
    expect(await count(extract(doc, [0]))).toBe(1)
    expect(await count(rotate(doc, 90))).toBe(n)
    if (n > 1) {
      expect(await count(remove(doc, [0]))).toBe(n - 1)
      const parts = split(doc, doc.pages().map((_, i) => [i]))
      expect(await Promise.all(parts.map(count))).toEqual(parts.map(() => 1))
    }
  })

  test('page content bytes are copied unchanged', async () => {
    const doc = await load()
    const out = await PdfDocument.load(extract(doc, [0]))
    const contents = (d: PdfDocument) => {
      const c = d.resolve(d.pages()[0].dict.get('Contents'))
      return [c].flat().map((x) => (d.resolve(x) as { data: Uint8Array }).data)
    }
    expect(contents(out).map((b) => Array.from(b))).toEqual(contents(doc).map((b) => Array.from(b)))
  })
})
