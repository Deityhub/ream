// Runs inside an Electron page (bundled by scripts/render-compare.ts): renders a PDF page with our renderer and
// compares it with a reference raster of the same page made by another renderer.
import { PdfDocument } from '@ream/pdf-core'
import { pageGeometry, renderPage } from '@ream/pdf-render'

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const png = async (c: OffscreenCanvas) => {
  const blob = await c.convertToBlob({ type: 'image/png' })
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

/** differences below this (max channel, 0-255) are treated as anti-aliasing noise */
const TOLERANCE = 48

export async function compare(pdfB64: string, refB64: string, page = 0) {
  const doc = await PdfDocument.load(bytesOf(pdfB64))
  const ref = await createImageBitmap(new Blob([bytesOf(refB64) as BlobPart], { type: 'image/png' }))
  const geo = pageGeometry(doc, page, ref.width)
  const { width: w, height: h } = geo

  const ours = new OffscreenCanvas(w, h)
  const t0 = performance.now()
  const { warnings } = await renderPage(doc, page, ours.getContext('2d')!, ref.width)
  const ms = Math.round(performance.now() - t0)

  const theirs = new OffscreenCanvas(w, h)
  const tctx = theirs.getContext('2d', { willReadFrequently: true })!
  tctx.fillStyle = '#fff'
  tctx.fillRect(0, 0, w, h)
  tctx.drawImage(ref, 0, 0, w, h)
  const a = ours.getContext('2d')!.getImageData(0, 0, w, h).data
  const b = tctx.getImageData(0, 0, w, h).data

  const out = new OffscreenCanvas(w * 3 + 8, h)
  const octx = out.getContext('2d')!
  octx.fillStyle = '#888'
  octx.fillRect(0, 0, out.width, out.height)
  octx.drawImage(ours, 0, 0)
  octx.drawImage(theirs, w + 4, 0)
  const diff = octx.createImageData(w, h)
  let bad = 0
  let sum = 0
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]))
    sum += d
    const isBad = d > TOLERANCE
    if (isBad) bad++
    diff.data[i] = isBad ? 220 : 255
    diff.data[i + 1] = isBad ? 40 : 255 - d
    diff.data[i + 2] = isBad ? 40 : 255 - d
    diff.data[i + 3] = 255
  }
  octx.putImageData(diff, (w + 4) * 2, 0)
  return {
    width: w,
    height: h,
    refHeight: ref.height,
    badPercent: +((bad / (w * h)) * 100).toFixed(2),
    meanDiff: +(sum / (w * h)).toFixed(2),
    ms,
    warnings,
    sheet: await png(out), // ours | reference | difference
  }
}

;(globalThis as unknown as { Harness: unknown }).Harness = { compare }
