import { beforeAll, describe, expect, test } from 'vitest'
import { UserError, type FileData } from '@ream/core'
import { createImage, encodePng, ownCodec, setCodec } from '@ream/image-core'
import { readFileSync } from 'node:fs'
import { PdfDocument, PdfPasswordError, PdfStream, decodeStream, decryptPdf, isName } from '@ream/pdf-core'
import { run as protect } from './protect-pdf/run.ts'
import { defaultOptions as protectDefaults } from './protect-pdf/options.ts'
import { run as unlock } from './unlock-pdf/run.ts'
import { run as sign } from './sign-pdf/run.ts'
import { defaultOptions as signDefaults, defaultRect, fitInside, pagesToSign } from './sign-pdf/place.ts'
import { classicPdf } from '../../pdf-core/test/helpers.ts'

beforeAll(() => setCodec(ownCodec))

const ctx = { progress: () => {} }
const pdf = (texts: string[], name = 'doc.pdf'): FileData => ({ name, type: 'application/pdf', bytes: classicPdf(texts) })
const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
const opts = (o: Partial<typeof protectDefaults> = {}) => ({ ...protectDefaults, password: 'secret-1', confirm: 'secret-1', ...o })

describe('protect-pdf', () => {
  test('writes a protected copy that opens with the password only', async () => {
    const [out] = await protect([pdf(['Hello'])], opts(), ctx)
    expect(out.name).toBe('doc-protected.pdf')
    expect(text(out.bytes)).not.toContain('Hello')
    await expect(PdfDocument.load(out.bytes)).rejects.toBeInstanceOf(PdfPasswordError)
    expect((await PdfDocument.load(out.bytes, { password: 'secret-1' })).pages().length).toBe(1)
  })

  test('AES-128 compatibility mode and an owner password', async () => {
    const [out] = await protect([pdf(['x'])], opts({ compatible: true, allowPrint: false, ownerPassword: 'boss' }), ctx)
    expect(text(out.bytes)).toContain('/AESV2')
    expect((await PdfDocument.load(out.bytes, { password: 'boss' })).pages().length).toBe(1)
    const [strong] = await protect([pdf(['x'])], opts(), ctx)
    expect(text(strong.bytes)).toContain('/AESV3')
  })

  test('mistakes are explained', async () => {
    await expect(protect([pdf(['x'])], opts({ password: '', confirm: '' }), ctx)).rejects.toThrow('Enter a password.')
    await expect(protect([pdf(['x'])], opts({ confirm: 'secret-2' }), ctx)).rejects.toThrow("don't match")
    await expect(protect([pdf(['x'])], opts({ ownerPassword: 'secret-1' }), ctx)).rejects.toThrow('different owner password')
    await expect(protect([{ name: 'x.pdf', type: 'application/pdf', bytes: new TextEncoder().encode('nope') }], opts(), ctx)).rejects.toBeInstanceOf(UserError)
  })
})

describe('unlock-pdf', () => {
  test('a protected file comes out open, with its text and pages', async () => {
    const [locked] = await protect([pdf(['Hello', 'Again'])], opts({ allowCopy: false }), ctx)
    // the app opens a locked file with its password when it is added, so the tool receives the plain copy
    const opened = await PdfDocument.load(locked.bytes, { password: 'secret-1' })
    expect(opened.encrypted).toBe(true)
    const plain = await decryptPdf(locked.bytes, 'secret-1')
    const [out] = await unlock([{ name: 'doc-protected.pdf', type: 'application/pdf', bytes: plain }], {}, ctx)
    expect(out.name).toBe('doc-protected-unlocked.pdf')
    const doc = await PdfDocument.load(out.bytes)
    expect(doc.encrypted).toBe(false)
    expect(doc.pages().length).toBe(2)
  })

  test('a file with only an owner password and limits is opened without asking', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../pdf-core/test/fixtures/enc-owner-only.pdf', import.meta.url)))
    expect((await PdfDocument.load(bytes)).encrypted).toBe(true)
    const [out] = await unlock([{ name: 'a.pdf', type: 'application/pdf', bytes }], {}, ctx)
    expect((await PdfDocument.load(out.bytes)).encrypted).toBe(false)
  })

  test('an unprotected file comes back as it was', async () => {
    const f = pdf(['x'])
    const [out] = await unlock([f], {}, ctx)
    expect(Array.from(out.bytes)).toEqual(Array.from(f.bytes))
  })
})

describe('sign-pdf place', () => {
  test('pages by scope', () => {
    expect(pagesToSign({ scope: 'all', page: 0 }, 3)).toEqual([0, 1, 2])
    expect(pagesToSign({ scope: 'last', page: 0 }, 3)).toEqual([2])
    expect(pagesToSign({ scope: 'page', page: 1 }, 3)).toEqual([1])
    expect(() => pagesToSign({ scope: 'page', page: 5 }, 3)).toThrow('no page 6')
  })

  test('the picture fits inside the box, centred, with the y axis turned over', () => {
    const page = { width: 200, height: 100 }
    // a box 100 x 50 pt, top left at (20, 10) from the top left
    const box = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }
    // a wide picture fills the width
    expect(fitInside(box, 4, page)).toEqual({ x: 20, y: 100 - 10 - 50 + (50 - 25) / 2, w: 100, h: 25 })
    // a tall picture fills the height and is centred across
    const tall = fitInside(box, 0.5, page)
    expect(tall.h).toBe(50)
    expect(tall.w).toBe(25)
    expect(tall.x).toBe(20 + (100 - 25) / 2)
    expect(tall.y).toBe(40)
  })
})

async function signature(w = 60, h = 20): Promise<Uint8Array> {
  const img = createImage(w, h)
  for (let i = 0; i < w * h; i++) img.data.set([20, 30, 160, (i % w) < w / 2 ? 255 : 0], i * 4)
  return encodePng(img)
}
const images = async (bytes: Uint8Array) => {
  const d = await PdfDocument.load(bytes)
  return [...d.objects.values()].filter((o): o is PdfStream => o instanceof PdfStream && isName(d.resolve(o.dict.get('Subtype')), 'Image'))
}
const pageStream = async (d: PdfDocument, i: number) => {
  const c = [d.resolve(d.pages()[i].dict.get('Contents'))].flat().map((x) => d.resolve(x as never))
  return (await Promise.all(c.map((s) => (s instanceof PdfStream ? decodeStream(s) : new Uint8Array())))).map(text).join('\n')
}

describe('sign-pdf', () => {
  test('puts the picture on the chosen page only, keeping the page\'s own content', async () => {
    const [out] = await sign([pdf(['One', 'Two', 'Three'])], { ...signDefaults, image: await signature(), scope: 'page', page: 1 }, ctx)
    expect(out.name).toBe('doc-signed.pdf')
    const d = await PdfDocument.load(out.bytes)
    expect(await pageStream(d, 0)).not.toContain('ReamSig')
    expect(await pageStream(d, 1)).toContain('/ReamSig Do')
    expect(await pageStream(d, 1)).toContain('(Two)')
    expect(await pageStream(d, 2)).not.toContain('ReamSig')
  })

  test('the picture keeps its transparency and is stored once however many pages show it', async () => {
    const [out] = await sign([pdf(['a', 'b', 'c'])], { ...signDefaults, image: await signature(), scope: 'all' }, ctx)
    const found = await images(out.bytes)
    expect(found.length).toBe(2) // the picture and its soft mask
    expect(found.some((i) => i.dict.has('SMask'))).toBe(true)
    const d = await PdfDocument.load(out.bytes)
    for (let i = 0; i < 3; i++) expect(await pageStream(d, i)).toContain('/ReamSig Do')
  })

  test('the last page is the default, and the box position lands where it was drawn', async () => {
    const [out] = await sign([pdf(['a', 'b'])], { ...signDefaults, image: await signature(100, 50), rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } }, ctx)
    const d = await PdfDocument.load(out.bytes)
    expect(await pageStream(d, 0)).not.toContain('ReamSig')
    // pages are 200 x 200: the box is the lower right quarter, so the 2:1 picture is 100 x 50 at (100, 25)
    expect(await pageStream(d, 1)).toMatch(/q 100 0 0 50 100 25 cm \/ReamSig Do Q/)
  })

  test('no signature yet is explained', async () => {
    await expect(sign([pdf(['x'])], { ...signDefaults, rect: defaultRect }, ctx)).rejects.toThrow('Make a signature first')
  })

  test('signing a protected file that was opened with its password works on the plain copy', async () => {
    const [locked] = await protect([pdf(['x'])], opts(), ctx)
    const plain = await decryptPdf(locked.bytes, 'secret-1')
    const [out] = await sign([{ name: 'l.pdf', type: 'application/pdf', bytes: plain }], { ...signDefaults, image: await signature() }, ctx)
    expect((await PdfDocument.load(out.bytes)).pages().length).toBe(1)
  })
})
