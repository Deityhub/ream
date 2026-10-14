import { describe, expect, test } from 'vitest'
import { PdfStream } from '@ream/pdf-core'
import { imagePlacements } from '../src/index.ts'
import { onePage, stream } from './helpers.ts'

const IMAGE = stream('/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8', 'abcdefghijklmnop')
const page = (content: string, objects: Record<number, string> = {}, resources = '/XObject << /Im 10 0 R >>') => onePage({ content, resources, objects: { 10: IMAGE, ...objects } })
const size = async (doc: Awaited<ReturnType<typeof page>>) => [...(await imagePlacements(doc)).values()]

describe('imagePlacements', () => {
  test('the size a picture is shown at, in points', async () => {
    expect(await size(await page('q 300 0 0 200 10 10 cm /Im Do Q'))).toEqual([{ width: 300, height: 200 }])
  })

  test('the largest of several uses wins', async () => {
    expect(await size(await page('q 50 0 0 40 0 0 cm /Im Do Q q 120 0 0 30 0 0 cm /Im Do Q'))).toEqual([{ width: 120, height: 40 }])
  })

  test('a turned picture still has its own width and height', async () => {
    expect(await size(await page('q 0 100 -50 0 60 0 cm /Im Do Q'))).toEqual([{ width: 100, height: 50 }])
  })

  test('inside a form, the form\'s matrix counts', async () => {
    const form = stream('/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Matrix [2 0 0 2 0 0] /Resources << /XObject << /Im 10 0 R >> >>', 'q 30 0 0 20 0 0 cm /Im Do Q')
    expect(await size(await page('/Fm Do', { 11: form }, '/XObject << /Fm 11 0 R >>'))).toEqual([{ width: 60, height: 40 }])
  })

  test('keyed by the picture\'s own stream, so the caller can find it again', async () => {
    const doc = await page('q 10 0 0 10 0 0 cm /Im Do Q')
    const placed = await imagePlacements(doc)
    const image = doc.objects.get(10) as PdfStream
    expect(placed.get(image)).toEqual({ width: 10, height: 10 })
  })

  test('a picture that is never drawn has no entry', async () => {
    expect(await size(await page('0 0 10 10 re f'))).toEqual([])
  })
})
