import { expect, test } from 'vitest'
import { unzip } from '@ream/core'
import { encodePng } from '@ream/image-core'
import { child, dig, kids, parseXml, readRels, relsOf, writeDocx, writePptx, writeXlsx, type XmlNode } from '../src/index.ts'

const dec = new TextDecoder()

/** every XML part parses; every relationship points at a part that exists; every part has a content type */
async function checkPackage(bytes: Uint8Array) {
  const parts = await unzip(bytes)
  const types = parseXml(dec.decode(parts.get('[Content_Types].xml')!))
  const defaults = new Set(kids(types, 'Default').map((d) => d.attrs.Extension))
  const overrides = new Set(kids(types, 'Override').map((o) => o.attrs.PartName.slice(1)))
  const xml = new Map<string, XmlNode>()
  for (const [name, data] of parts) {
    if (/\.(xml|rels)$/.test(name)) xml.set(name, parseXml(dec.decode(data)))
    if (name !== '[Content_Types].xml') expect(overrides.has(name) || defaults.has(name.split('.').pop()!), `${name} has a content type`).toBe(true)
  }
  for (const name of [...parts.keys()].filter((n) => n.endsWith('.rels'))) {
    const owner = name.replace('_rels/', '').replace(/\.rels$/, '')
    for (const [id, r] of readRels(xml.get(name), owner === '' || name === '_rels/.rels' ? '' : owner)) expect(parts.has(r.part), `${name} ${id} -> ${r.part}`).toBe(true)
  }
  expect(relsOf('word/document.xml')).toBe('word/_rels/document.xml.rels')
  return { parts, xml }
}

const png = async () => encodePng({ width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) })

test('docx: well-formed, every relationship resolves, sections keep their own page size', async () => {
  const { xml } = await checkPackage(
    await writeDocx({
      sections: [
        { width: 595, height: 842, margins: { top: 50, right: 50, bottom: 50, left: 50 }, blocks: [{ kind: 'p', runs: [{ text: 'a & b < c', bold: true }] }, { kind: 'picture', bytes: await png(), type: 'png', width: 10, height: 10 }] },
        { width: 842, height: 595, margins: { top: 0, right: 0, bottom: 0, left: 0 }, blocks: [{ kind: 'picture', bytes: await png(), type: 'png', width: 842, height: 595, at: { x: 0, y: 0 } }] },
      ],
    }),
  )
  const body = child(xml.get('word/document.xml'), 'body')!
  const sizes = [...body.children.flatMap((c) => (c.name === 'p' ? [dig(c, 'pPr', 'sectPr', 'pgSz')] : [])), dig(body, 'sectPr', 'pgSz')].filter(Boolean).map((s) => s!.attrs.w)
  expect(sizes).toEqual(['11900', '16840'])
})

test('pptx: well-formed, slide size in twips of EMU, media and tables wired up, text and invisible text kept', async () => {
  const { xml } = await checkPackage(
    await writePptx({
      width: 720, height: 405,
      slides: [
        { shapes: [{ kind: 'pic', x: 0, y: 0, w: 720, h: 405, bytes: await png(), type: 'png' }, { kind: 'text', x: 1, y: 2, w: 100, h: 20, paragraphs: [{ runs: [{ text: 'words' }, { text: '\nnext', size: 12 }] }] }] },
        { shapes: [{ kind: 'table', x: 0, y: 0, w: 100, h: 20, colWidths: [50, 50], rowHeights: [20], cells: [[{ paragraphs: [{ runs: [{ text: 'x' }] }], cols: 2 }, { paragraphs: [], covered: 'h' }]] }] },
      ],
    }),
  )
  expect(dig(xml.get('ppt/presentation.xml'), 'sldSz')!.attrs).toMatchObject({ cx: '9144000', cy: '5143500' })
  const slide1 = xml.get('ppt/slides/slide1.xml')!
  expect(JSON.stringify(slide1)).toContain('next')
  expect(JSON.stringify(xml.get('ppt/slides/slide2.xml'))).toContain('hMerge')
  expect(kids(dig(xml.get('ppt/presentation.xml'), 'sldIdLst'), 'sldId')).toHaveLength(2)
})

test('xlsx: the same package checks pass', async () => {
  await checkPackage(await writeXlsx([{ name: 'S', rows: [[{ value: 'x', style: { bold: true, fill: 'FFFF00', border: { top: 'thin' }, numFmt: '0.0%' } }]] }]))
})
