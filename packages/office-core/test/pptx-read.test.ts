import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { UserError, zip } from '@ream/core'
import { encodePng } from '@ream/image-core'
import { readPptx, readXlsx, writePptx, type SlideBox } from '../src/index.ts'

const fixture = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)))
const texts = (b: SlideBox) => b.paragraphs.map((p) => p.runs.map((r) => r.text).join(''))

// deck.pptx was made by python-pptx from its default template: a real master, layouts and theme
test('a deck from another program: placeholders take place, size, bullets and alignment from layout and master', async () => {
  const deck = await readPptx(fixture('deck.pptx'))
  expect([deck.width, deck.height, deck.slides.length]).toEqual([720, 540, 3])
  const [title, sub] = deck.slides[0].shapes as SlideBox[]
  expect(texts(title)).toEqual(['Quarterly review'])
  expect(title).toMatchObject({ x: 54, w: 612, anchor: 'middle' }) // from the master: the slide itself has no position
  expect(title.paragraphs[0]).toMatchObject({ align: 'center' })
  expect(title.paragraphs[0].runs[0]).toMatchObject({ size: 44, font: 'Calibri' })
  expect(sub.paragraphs[0].runs[0]).toMatchObject({ size: 32, color: '404040' })
  const body = deck.slides[1].shapes[1] as SlideBox
  expect(body.paragraphs.map((p) => [p.bullet, p.runs[0].size])).toEqual([['•', 32], ['–', 28], ['•', 32], ['•', 32]])
  expect(body.paragraphs[1].marginLeft).toBeGreaterThan(body.paragraphs[0].marginLeft!) // level 2 sits further in
  expect(body.paragraphs[0].indent).toBeLessThan(0)
})

test('shapes: own colours, style references for fill and text colour, geometry, rotation, picture, table style, connector', async () => {
  const s = (await readPptx(fixture('deck.pptx'))).slides[2]
  const [free, rect, oval, arrow, round, pic, table, line] = s.shapes
  expect((free as SlideBox).paragraphs[0].runs[0]).toMatchObject({ font: 'Georgia', size: 28, bold: true, color: 'C0392B' })
  expect((free as SlideBox).paragraphs[1]).toMatchObject({ align: 'right' })
  expect(free).toMatchObject({ wrap: false })
  expect(rect).toMatchObject({ fill: '4F81BD', geometry: 'rect' }) // accent1 of the theme, from the style reference
  expect((rect as SlideBox).paragraphs[0].runs[0].color).toBe('FFFFFF') // the style's font reference: light text
  expect(oval).toMatchObject({ fill: 'F1C40F', geometry: 'ellipse', line: { color: '000000' } })
  expect(arrow).toMatchObject({ geometry: 'rightArrow', rotation: 20 })
  expect(round).toMatchObject({ geometry: 'roundRect', anchor: 'middle' })
  expect(pic).toMatchObject({ kind: 'pic', type: 'png', w: 108, h: 79.2 })
  expect(table.kind).toBe('table')
  const cells = (table as Extract<typeof table, { kind: 'table' }>).cells
  expect(cells.map((r) => r[0].fill)).toEqual(['4F81BD', 'B9CDE5', 'DCE6F2']) // header, then the two bands of the default table style
  expect(cells[0][0].paragraphs[0].runs[0]).toMatchObject({ bold: true, color: 'FFFFFF' })
  expect(line.kind).toBe('line')
})

test('what the writer writes, the reader reads back', async () => {
  const png = await encodePng({ width: 2, height: 2, data: new Uint8ClampedArray(16).fill(200) })
  const deck = await readPptx(
    await writePptx({
      width: 640, height: 360,
      slides: [
        { background: 'EEEEEE', shapes: [
          { kind: 'text', x: 10, y: 20, w: 300, h: 50, paragraphs: [{ runs: [{ text: 'Hello ', size: 20, bold: true, color: 'AA0000', font: 'Arial' }, { text: 'world', size: 20, italic: true }], align: 'center', bullet: '•', marginLeft: 18, indent: -18 }] },
          { kind: 'pic', x: 100, y: 100, w: 50, h: 40, bytes: png, type: 'png', crop: [0.1, 0, 0.1, 0] },
          { kind: 'table', x: 0, y: 200, w: 200, h: 40, colWidths: [100, 100], rowHeights: [40], cells: [[{ paragraphs: [{ runs: [{ text: 'a', size: 12 }] }], cols: 2, fill: 'FFFF00' }, { paragraphs: [], covered: 'h' }]] },
        ] },
      ],
    }),
  )
  const [s] = deck.slides
  expect(s.background).toBe('EEEEEE')
  const [box, pic, tbl] = s.shapes
  expect(box).toMatchObject({ x: 10, y: 20, w: 300, h: 50 })
  expect((box as SlideBox).paragraphs[0]).toMatchObject({ align: 'center', bullet: '•', marginLeft: 18, indent: -18 })
  expect((box as SlideBox).paragraphs[0].runs).toMatchObject([{ text: 'Hello ', bold: true, color: 'AA0000', font: 'Arial', size: 20 }, { text: 'world', italic: true, size: 20 }])
  expect(pic).toMatchObject({ x: 100, w: 50, crop: [0.1, 0, 0.1, 0] })
  expect(pic.kind === 'pic' && pic.bytes.length).toBe(png.length)
  expect(tbl.kind === 'table' && tbl.cells[0].map((c) => [c.cols, c.covered, c.fill])).toEqual([[2, undefined, 'FFFF00'], [undefined, 'h', undefined]])
})

const enc = (s: string) => new TextEncoder().encode(s)
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const rels = (items: [string, string, string][]) => `<Relationships xmlns="x">${items.map(([id, t, target]) => `<Relationship Id="${id}" Type="http://x/${t}" Target="${target}"/>`).join('')}</Relationships>`
const tree = (inner: string, bg = '') => `<p:cSld>${bg}<p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${inner}</p:spTree></p:cSld>`

/** a tiny package: one master, one layout with a body placeholder, and the given slide shapes */
function mini(slideShapes: string, slideAttrs = '', bg = '', master = '') {
  return zip(
    ([
      ['_rels/.rels', rels([['r1', 'officeDocument', 'ppt/presentation.xml']])],
      ['ppt/presentation.xml', `<p:presentation ${NS}><p:sldMasterIdLst/><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`],
      ['ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/m.xml'], ['rId2', 'slide', 'slides/s.xml']])],
      ['ppt/slideMasters/m.xml', `<p:sldMaster ${NS}>${tree('')}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"/>${master}<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4000"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buChar char="•"/><a:defRPr sz="2000"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>`],
      ['ppt/slideMasters/_rels/m.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/l.xml']])],
      ['ppt/slideLayouts/l.xml', `<p:sldLayout ${NS}>${tree('<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1270000" y="2540000"/><a:ext cx="6350000" cy="2540000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/></p:txBody></p:sp>')}</p:sldLayout>`],
      ['ppt/slideLayouts/_rels/l.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/m.xml']])],
      ['ppt/slides/s.xml', `<p:sld ${NS} ${slideAttrs}>${tree(slideShapes, bg)}</p:sld>`],
      ['ppt/slides/_rels/s.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/l.xml']])],
      ['ppt/theme/theme1.xml', '<a:theme/>'],
    ] as [string, string][]).map(([name, text]) => ({ name, bytes: enc(text) })),
  )
}

test('a placeholder found by index, text style from the master, body anchor from the layout, shrink-to-fit scale applied', async () => {
  const deck = await readPptx(mini('<p:sp><p:nvSpPr><p:cNvPr id="2" name="B"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr><a:normAutofit fontScale="50000" lnSpcReduction="10000"/></a:bodyPr><a:lstStyle/><a:p><a:r><a:t>Text</a:t></a:r></a:p></p:txBody></p:sp>'))
  const [b] = deck.slides[0].shapes as SlideBox[]
  expect(b).toMatchObject({ x: 100, y: 200, w: 500, h: 200, anchor: 'middle', fontScale: 0.5, lineReduction: 0.1 })
  expect(b.paragraphs[0]).toMatchObject({ bullet: '•', marginLeft: 18, indent: -18 })
  expect(b.paragraphs[0].runs[0].size).toBe(10) // 20 pt from the master, halved by the autofit scale
  expect(b.paragraphs[0].runs[0].color).toBe('44546A') // tx2 through the colour map: dk2 of the default theme
})

test('groups scale and move their children; hidden slides are marked; backgrounds from colour references', async () => {
  const group = '<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="2540000" cy="2540000"/><a:chOff x="0" y="0"/><a:chExt cx="1270000" cy="1270000"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="3" name="in"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="635000" y="635000"/><a:ext cx="635000" cy="317500"/></a:xfrm><a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></p:spPr></p:sp></p:grpSp>'
  const deck = await readPptx(mini(group, 'show="0"', '<p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></p:bgPr></p:bg>'))
  const [s] = deck.slides
  expect(s.hidden).toBe(true)
  expect(s.background).toBe('E7E6E6') // bg2 -> lt2
  // the group is shown twice as big as its own coordinates and moved by (100, 100): the child at (50, 50) size 50 x 25 -> (200, 200) size 100 x 50
  expect(s.shapes[0]).toMatchObject({ x: 200, y: 200, w: 100, h: 50, fill: '00FF00', geometry: 'ellipse' })
})

test('files that are not presentations are refused in plain words', async () => {
  await expect(readPptx(zip([{ name: 'a.txt', bytes: enc('x') }]))).rejects.toThrow(/PowerPoint presentation/)
  await expect(readPptx(enc('not a zip, not a zip, not a zip, not a zip'))).rejects.toBeInstanceOf(UserError)
})

test('the spreadsheet fixture from openpyxl reads as it was made', async () => {
  const book = await readXlsx(fixture('report.xlsx'))
  const s = book.sheets[0]
  expect(s.name).toBe('Sales report')
  expect(s.merges).toContainEqual({ row: 0, col: 0, rows: 1, cols: 5 })
  expect(s.rows[3]![3]).toMatchObject({ value: 4560.5, text: '$4,560.50' })
  expect(s.rows[6]![3]!.text).toBe('-$150.75')
  expect(s.rows[8]![1]!.text).toBe('15 March 2024')
  expect(s.rows[2]![0]!.style).toMatchObject({ bold: true, color: 'FFFFFF', fill: '1F4E79' })
})
