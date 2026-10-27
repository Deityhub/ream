import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { PdfDocument, PdfRef, PdfStream, PdfString, decodeStream, deflate, optimize } from '../src/index.ts'
import { assemble } from './helpers.ts'
import { latin1 } from '../src/bytes.ts'

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)))
const body = (extra: string, data: string) => `<< ${extra} /Length ${data.length} >>\nstream\n${data}\nendstream`
const s = (bytes: Uint8Array) => latin1(bytes)

/** a document: catalog, pages, one page per entry of `pages` (each given its content text and resources), plus extra objects */
function doc(o: { pages: { content: string; resources?: string; filter?: string }[]; extra?: [number, string][]; catalog?: string; trailer?: string }) {
  const first = 10
  const objs: [number, string][] = [
    [1, `<< /Type /Catalog /Pages 2 0 R ${o.catalog ?? ''} >>`],
    [2, `<< /Type /Pages /Kids [${o.pages.map((_, i) => `${first + 2 * i} 0 R`).join(' ')}] /Count ${o.pages.length} >>`],
  ]
  o.pages.forEach((p, i) => {
    objs.push([first + 2 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << ${p.resources ?? ''} >> /Contents ${first + 2 * i + 1} 0 R >>`])
    objs.push([first + 2 * i + 1, body(p.filter ?? '', p.content)])
  })
  objs.push(...(o.extra ?? []))
  return assemble(objs, o.trailer ?? '').bytes
}

const load = (b: Uint8Array) => PdfDocument.load(b)
const decoded = async (d: PdfDocument, ref: PdfRef | undefined) => {
  const st = d.resolve(ref)
  return st instanceof PdfStream ? s(await decodeStream(st)) : ''
}
/** the text of every page's content */
async function pageContents(d: PdfDocument) {
  return Promise.all(d.pages().map(async (p) => (await decoded(d, p.dict.get('Contents') as PdfRef)) ))
}
const repeated = 'BT /F1 12 Tf 20 100 Td (Hello hello hello hello) Tj ET\n'.repeat(60)

describe('optimize', () => {
  test('keeps what the pages show and writes a smaller file', async () => {
    const src = doc({ pages: [{ content: repeated }, { content: 'q 1 0 0 1 5 5 cm Q\n'.repeat(80) }] })
    const out = await optimize(await load(src))
    const d = await load(out)
    expect(d.pages().length).toBe(2)
    expect(await pageContents(d)).toEqual([repeated, 'q 1 0 0 1 5 5 cm Q\n'.repeat(80)])
    expect(out.length).toBeLessThan(src.length * 0.5)
  })

  test('objects nothing refers to are left out', async () => {
    const src = doc({ pages: [{ content: 'q Q' }], extra: [[40, body('', 'JUNKJUNKJUNK-NOBODY-USES-THIS'.repeat(5))], [41, '<< /Orphan true >>']] })
    const out = await optimize(await load(src))
    expect(s(out)).not.toContain('Orphan')
    const d = await load(out)
    expect([...d.objects.values()].some((o) => o instanceof PdfStream && s(o.data).includes('JUNK'))).toBe(false)
  })

  test('uncompressed streams are compressed, and the data reads back the same', async () => {
    const src = doc({ pages: [{ content: repeated }] })
    const d = await load(await optimize(await load(src)))
    const c = d.resolve(d.pages()[0].dict.get('Contents')) as PdfStream
    expect(String(c.dict.get('Filter') && (c.dict.get('Filter') as { value: string }).value)).toBe('FlateDecode')
    expect(c.data.length).toBeLessThan(repeated.length / 5)
    expect(s(await decodeStream(c))).toBe(repeated)
  })

  test('streams in other filters (ASCII hex here) become Flate', async () => {
    const hex = Array.from(repeated, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('') + '>'
    const d = await load(await optimize(await load(doc({ pages: [{ content: hex, filter: '/Filter /ASCIIHexDecode' }] }))))
    expect(await pageContents(d)).toEqual([repeated])
    const c = d.resolve(d.pages()[0].dict.get('Contents')) as PdfStream
    expect((c.dict.get('Filter') as { value: string }).value).toBe('FlateDecode')
    expect(c.data.length).toBeLessThan(hex.length / 10)
  })

  test('a stream already stored as small as it gets is kept as it is', async () => {
    const z = await deflate(new TextEncoder().encode(repeated))
    const bytes = doc({ pages: [{ content: 'q Q' }], extra: [[40, body('/Filter /FlateDecode', s(z))]], catalog: '/Extra 40 0 R' })
    const d = await load(await optimize(await load(bytes)))
    const kept = d.resolve(d.catalog().get('Extra') as PdfRef) as PdfStream
    expect(Array.from(kept.data)).toEqual(Array.from(z))
  })

  test('identical pictures are stored once, different ones stay apart', async () => {
    const img = (data: string) => body('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8', data)
    const src = doc({
      pages: [{ content: '/A Do', resources: '/XObject << /A 40 0 R >>' }, { content: '/B Do', resources: '/XObject << /B 41 0 R >>' }, { content: '/C Do', resources: '/XObject << /C 42 0 R >>' }],
      extra: [[40, img('abcd')], [41, img('abcd')], [42, img('abce')]],
    })
    const d = await load(await optimize(await load(src)))
    const refOf = (i: number) => {
      const x = d.resolve(d.pages()[i].dict.get('Resources')) as Map<string, unknown>
      const xo = d.resolve(x.get('XObject') as never) as Map<string, PdfRef>
      return [...xo.values()][0].num
    }
    expect(refOf(0)).toBe(refOf(1))
    expect(refOf(2)).not.toBe(refOf(0))
    const images = [...d.objects.values()].filter((o) => o instanceof PdfStream && o.dict.has('Width'))
    expect(images.length).toBe(2)
  })

  test('fonts that differ only in repeated font files are stored once (descriptors match after their files do)', async () => {
    const file = body('/Length1 10', 'FONTPROGRAM-DATA-DATA-DATA')
    const desc = (n: number) => `<< /Type /FontDescriptor /FontName /AAAAAA+Foo /Flags 4 /FontFile2 ${n} 0 R >>`
    const font = (n: number) => `<< /Type /Font /Subtype /TrueType /BaseFont /AAAAAA+Foo /FontDescriptor ${n} 0 R >>`
    const src = doc({
      pages: [{ content: 'BT /F Tf ET', resources: '/Font << /F 40 0 R >>' }, { content: 'BT /F Tf ET', resources: '/Font << /F 41 0 R >>' }],
      extra: [[40, font(42)], [41, font(43)], [42, desc(44)], [43, desc(45)], [44, file], [45, file]],
    })
    const d = await load(await optimize(await load(src)))
    expect([...d.objects.values()].filter((o) => o instanceof Map && (o.get('Type') as { value: string } | undefined)?.value === 'Font').length).toBe(1)
    expect([...d.objects.values()].filter((o) => o instanceof PdfStream && s(o.data).includes('FONTPROGRAM')).length).toBe(1)
  })

  test('pages that look alike stay separate pages', async () => {
    const d = await load(await optimize(await load(doc({ pages: [{ content: 'q Q' }, { content: 'q Q' }, { content: 'q Q' }] }))))
    expect(d.pages().length).toBe(3)
  })

  test('bookmarks, forms, labels and information survive', async () => {
    const src = doc({
      pages: [{ content: 'q Q' }],
      catalog: '/Outlines 40 0 R /AcroForm 43 0 R /PageLabels << /Nums [0 << /S /r >>] >> /Lang (en)',
      extra: [
        [40, '<< /Type /Outlines /First 41 0 R /Last 41 0 R /Count 1 >>'],
        [41, '<< /Title (Chapter one) /Parent 40 0 R /Dest [10 0 R /Fit] >>'],
        [43, '<< /Fields [44 0 R] /DA (/Helv 0 Tf 0 g) >>'],
        [44, '<< /FT /Tx /T (name) /V (Jude) /Rect [0 0 0 0] /Subtype /Widget /Type /Annot >>'],
        [45, '<< /Title (My file) /Author (Jude) >>'],
      ],
      trailer: '/Info 45 0 R',
    })
    const d = await load(await optimize(await load(src)))
    const cat = d.catalog()
    const str = (o: unknown) => (o instanceof PdfString ? s(o.bytes) : '')
    const outline = d.resolve(cat.get('Outlines')) as Map<string, unknown>
    expect(outline.get('Count')).toBe(1)
    expect(str((d.resolve(outline.get('First') as never) as Map<string, unknown>).get('Title'))).toBe('Chapter one')
    const form = d.resolve(cat.get('AcroForm')) as Map<string, unknown>
    const field = d.resolve((form.get('Fields') as PdfRef[])[0]) as Map<string, unknown>
    expect(str(field.get('V'))).toBe('Jude')
    expect(cat.get('Lang') instanceof PdfString).toBe(true)
    const info = d.resolve(d.trailer.get('Info')) as Map<string, unknown>
    expect(str(info.get('Title'))).toBe('My file')
    // the bookmark still points at the page
    const dest = (d.resolve(outline.get('First') as never) as Map<string, unknown>).get('Dest') as PdfRef[]
    expect(d.resolve(dest[0])).toBe(d.pages()[0].dict)
  })

  test('page thumbnails and private application data are dropped', async () => {
    const src = doc({
      pages: [{ content: 'q Q' }],
      catalog: '/PieceInfo << /App << /Private 41 0 R >> >>',
      extra: [[41, body('', 'PRIVATE-ILLUSTRATOR-FILE-'.repeat(20))], [40, body('/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', 'T')]],
    }).slice()
    const text = new TextDecoder('latin1').decode(src).replace('/Contents 11 0 R', '/Contents 11 0 R /Thumb 40 0 R')
    const out = await optimize(await load(new Uint8Array([...text].map((c) => c.charCodeAt(0)))))
    const d = await load(out)
    expect(d.pages()[0].dict.has('Thumb')).toBe(false)
    expect([...d.objects.values()].some((o) => o instanceof PdfStream && s(o.data).includes('PRIVATE'))).toBe(false)
  })

  test('PDF 1.5 object streams by default (and a classic file when asked)', async () => {
    const src = doc({ pages: Array.from({ length: 30 }, (_, i) => ({ content: `(page ${i})` })) })
    const packed = await optimize(await load(src))
    expect(s(packed.subarray(0, 8))).toBe('%PDF-1.5')
    expect(s(packed)).toContain('/Type /ObjStm')
    expect(s(packed)).not.toContain('\nxref\n')
    const classic = await optimize(await load(src), { objectStreams: false })
    expect(s(classic)).toContain('\nxref\n')
    expect(packed.length).toBeLessThan(classic.length)
    for (const bytes of [packed, classic]) expect((await load(bytes)).pages().length).toBe(30)
  })

  test('a stream can be swapped for another (how pictures are replaced)', async () => {
    const img = body('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8', 'abcd')
    const src = doc({ pages: [{ content: '/A Do', resources: '/XObject << /A 40 0 R >>' }], extra: [[40, img]] })
    const before = await load(src)
    const old = before.objects.get(40) as PdfStream
    const swapped = new PdfStream(new Map(old.dict), new TextEncoder().encode('WXYZ'))
    const d = await load(await optimize(before, { replace: new Map([[old, swapped]]) }))
    const found = [...d.objects.values()].filter((o): o is PdfStream => o instanceof PdfStream && o.dict.has('Width'))
    expect(found.map((o) => s(o.data))).toEqual(['WXYZ'])
  })

  test('optimising twice does not grow the file', async () => {
    const once = await optimize(await load(doc({ pages: [{ content: repeated }] })))
    const twice = await optimize(await load(once))
    expect(twice.length).toBeLessThanOrEqual(once.length + 8)
    expect(await pageContents(await load(twice))).toEqual([repeated])
  })

  test('real files: same pages, smaller', async () => {
    for (const name of ['chromium.pdf', 'cups.pdf']) {
      const src = fixture(name)
      const before = await load(src)
      const out = await optimize(before)
      const after = await load(out)
      expect(after.pages().length).toBe(before.pages().length)
      expect(await pageContents(after)).toEqual(await pageContents(before))
      expect(out.length).toBeLessThan(src.length)
    }
  })

  test('references to objects that are not there become null instead of failing', async () => {
    const src = doc({ pages: [{ content: 'q Q' }], catalog: '/Dangling 99 0 R' })
    const d = await load(await optimize(await load(src)))
    expect(d.catalog().get('Dangling') ?? null).toBe(null)
  })
})
