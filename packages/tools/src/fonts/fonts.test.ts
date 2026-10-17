import { describe, expect, test } from 'vitest'
import { makeTtf } from '../../../pdf-core/test/ttf-helper.ts'
import { FontBook, type InstalledFont } from './book.ts'
import { downloadFreeFont } from './download.ts'
import { closestFamily, weightOf, withoutWeight } from './match.ts'
import { nodeFonts } from './node.ts'

describe('finding the font a file asks for', () => {
  test('close names: weight and edition words drop, a different kind of type never matches', () => {
    const installed = ['Gill Sans', 'Baskerville', 'Century', 'Arial', 'Helvetica Neue']
    expect(closestFamily('Arial', installed)).toEqual({ family: 'Arial', exact: true })
    expect(closestFamily('Gill Sans Nova Light', installed)).toEqual({ family: 'Gill Sans', exact: false })
    expect(closestFamily('Baskerville Old Face', installed)).toEqual({ family: 'Baskerville', exact: false })
    expect(closestFamily('Arial Nova', installed)).toEqual({ family: 'Arial', exact: false })
    expect(closestFamily('Century Gothic', installed)).toBeNull() // Century is a serif, Century Gothic a sans
    expect(closestFamily('Helvetica Neue Light', installed)).toEqual({ family: 'Helvetica Neue', exact: false })
    expect(closestFamily('Posterama', installed)).toBeNull()
    expect([weightOf('Light'), weightOf('SemiBold'), weightOf('ExtraLight Italic'), weightOf('Regular'), weightOf('Black')]).toEqual([300, 600, 200, 400, 900])
    expect(withoutWeight('Gill Sans Nova Light')).toBe('Gill Sans Nova')
  })

  /** the test font under another 8-letter name, so the file the book picks can be told apart */
  const named = (name: string) => {
    const b = makeTtf()
    const from = [...'TestFont'].flatMap((c) => [0, c.charCodeAt(0)])
    const at = b.findIndex((_, i) => from.every((v, k) => b[i + k] === v))
    b.set([...name.padEnd(8, 'x').slice(0, 8)].flatMap((c) => [0, c.charCodeAt(0)]), at)
    return b
  }

  test('the font book uses the files found for a family: the weight its name asks for, bold for bold, the slant', async () => {
    const face = (style: string, name: string): InstalledFont => ({ family: 'Gill Sans', style, postscript: '', bytes: named(name), for: 'Gill Sans Nova Light', source: 'installed' })
    const book = new FontBook(nodeFonts, [face('Regular', 'Regular1'), face('Light', 'Light111'), face('Bold', 'Bold1111'), face('Light Italic', 'LightIta')])
    const name = 'Gill Sans Nova Light'
    await book.load([{ name, text: 'A' }, { name, bold: true, text: 'A' }, { name, italic: true, text: 'A' }, { name: 'Calibri', text: 'A' }])
    const pick = (bold = false, italic = false) => book.spec(name, bold, italic).face!.parts[0].name
    expect([pick(), pick(true), pick(false, true)]).toEqual(['Light111', 'Bold1111', 'LightIta'])
    // the PDF keeps the family the file asked for
    expect(book.spec(name).name).toBe(name)
    expect(book.substituted.has(name)).toBe(false)
  })

  test('several files of one style are used together, as one face', async () => {
    const part = (style: string): InstalledFont => ({ family: 'Libre Baskerville', style, postscript: '', bytes: makeTtf(), for: 'Baskerville Old Face', source: 'download' })
    const book = new FontBook(nodeFonts, [part('Regular'), part('Regular'), part('Bold')])
    await book.load([{ name: 'Baskerville Old Face', text: 'AЖ' }])
    expect(book.spec('Baskerville Old Face').face!.parts).toHaveLength(2)
  })
})

describe('free fonts', () => {
  const meta = { id: 'libre-baskerville', family: 'Libre Baskerville', weights: [400, 700], styles: ['normal', 'italic'], subsets: ['latin', 'latin-ext', 'cyrillic'], variants: {} as Record<string, Record<string, Record<string, { url: { ttf: string } }>>> }
  for (const w of [400, 700]) for (const st of ['normal', 'italic']) for (const sub of ['latin', 'latin-ext', 'cyrillic']) ((meta.variants[w] ??= {})[st] ??= {})[sub] = { url: { ttf: `https://cdn/${w}-${st}-${sub}.ttf` } }
  const asked: string[] = []
  const fake = (async (url: string) => {
    asked.push(url)
    if (url.endsWith('/libre-baskerville')) return new Response(JSON.stringify(meta))
    if (url.startsWith('https://cdn/')) return new Response(new Uint8Array([1, 2, 3]))
    return new Response('not found', { status: 404 })
  }) as typeof fetch

  test('a family Fontsource has: regular and bold, upright and italic, latin parts only, named for the font asked for', async () => {
    asked.length = 0
    const files = await downloadFreeFont('Libre Baskerville', fake)
    expect(files?.map((f) => f.style)).toEqual(['Regular', 'Regular', 'Regular Italic', 'Regular Italic', 'Bold', 'Bold', 'Bold Italic', 'Bold Italic'])
    expect(files?.every((f) => f.for === 'Libre Baskerville' && f.source === 'download' && f.family === 'Libre Baskerville')).toBe(true)
    expect(asked.some((u) => u.includes('cyrillic'))).toBe(false)
    // only names go out: the API, then the font files
    expect(asked[0]).toBe('https://api.fontsource.org/v1/fonts/libre-baskerville')
  })

  test('a commercial font is not there: null, after trying the name without its weight', async () => {
    asked.length = 0
    expect(await downloadFreeFont('Gill Sans Nova Light', fake)).toBeNull()
    expect(asked).toEqual(['https://api.fontsource.org/v1/fonts/gill-sans-nova-light', 'https://api.fontsource.org/v1/fonts/gill-sans-nova'])
  })
})
