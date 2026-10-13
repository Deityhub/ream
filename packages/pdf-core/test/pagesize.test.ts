import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { PdfDocument, rotate } from '../src/index.ts'
import { classicPdf } from './helpers.ts'

const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', name)))
const sizes = (d: PdfDocument) => d.pages().map((p) => d.pageSize(p))
const round = (s: { width: number; height: number }) => [Math.round(s.width), Math.round(s.height)]

describe('pageSize', () => {
  test('real files: A4 from Chromium, US Letter from Quartz', async () => {
    expect(sizes(await PdfDocument.load(fixture('chromium.pdf'))).map(round)).toEqual([[596, 843], [596, 843], [596, 843]])
    expect(sizes(await PdfDocument.load(fixture('cups.pdf'))).map(round)).toEqual([[612, 792], [612, 792], [612, 792]])
  })

  test('rotation by 90 or 270 swaps width and height; 180 does not', async () => {
    const doc = await PdfDocument.load(classicPdf(['A', 'B', 'C'])) // 200 x 200 pages: use cups for a non-square page
    const cups = await PdfDocument.load(fixture('cups.pdf'))
    expect(round(sizes(await PdfDocument.load(rotate(cups, 90, [0])))[0])).toEqual([792, 612])
    expect(round(sizes(await PdfDocument.load(rotate(cups, 270, [0])))[0])).toEqual([792, 612])
    expect(round(sizes(await PdfDocument.load(rotate(cups, 180, [0])))[0])).toEqual([612, 792])
    expect(sizes(doc).map(round)).toEqual([[200, 200], [200, 200], [200, 200]])
  })

  test('an unusable box falls back to US Letter instead of throwing', async () => {
    const bad = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 /Foo] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n',
    )
    expect(round(sizes(await PdfDocument.load(bad))[0])).toEqual([612, 792])
  })
})
