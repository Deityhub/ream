import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { readDocx, usedFonts, type DocBlock, type Paragraph } from '../src/index.ts'
import { PIXEL, inline, makeDocx, para, part, scramble, withFonts } from './docx-helper.ts'

// report.docx (python-docx, its default template): a title, mixed runs, a centred line, bullets, a numbered list, a grid
// table, a picture, a page break and a heading on the second page
test('a Word document reads with styles resolved: sizes and colours from the style chain, list markers, a table, a picture', async () => {
  const [s] = (await readDocx(new Uint8Array(readFileSync(new URL('./fixtures/report.docx', import.meta.url))))).sections
  expect([s.width, s.height]).toEqual([612, 792])
  const paras = s.blocks.filter((b): b is Paragraph => b.kind === 'p' && b.runs.length > 0)
  const text = (p: Paragraph) => p.runs.map((r) => r.text).join('')
  // the picture sits in a paragraph of its own (the empty text between 'Step two' and 'Second page')
  expect(paras.map(text)).toEqual(['Annual report', 'Plain text, bold red and more.', 'Centred line', 'First point', 'Second point', 'Step one', 'Step two', '', 'Second page', 'Closing words.'])
  // the Title style: 26 pt in the theme's dark blue
  expect(paras[0].runs[0]).toMatchObject({ size: 26, color: '17365D' })
  expect(paras[1].runs[1]).toMatchObject({ text: 'bold red', bold: true, color: 'C00000' })
  expect(paras[2].align).toBe('center')
  expect(paras.slice(3, 7).map((p) => p.marker)).toEqual(['•', '•', '1.', '2.'])
  const table = s.blocks.find((b) => b.kind === 'table') as Extract<DocBlock, { kind: 'table' }>
  expect(table.rows.map((r) => r.map((c) => c.paragraphs.map(text).join('')))).toEqual([['Item', 'Price'], ['Tea', '4.50']])
  expect(paras.flatMap((p) => p.runs).find((r) => r.picture)?.picture).toMatchObject({ type: 'png', width: 144, height: 72 })
  const breakAt = s.blocks.findIndex((b) => b.kind === 'p' && b.pageBreakBefore)
  expect(breakAt).toBeGreaterThan(s.blocks.findIndex((b) => b.kind === 'picture'))
})

// made by hand: a document of two sections where the second names no footer, a different first page, a footer with tab stops and
// page number fields of both kinds, links of three kinds, headings and what keeps paragraphs together
test('headers and footers, fields, links, headings and keep settings are read', async () => {
  const styles =
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/><w:keepLines/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr></w:style>'
  const footer = part(
    'ftr',
    '<w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t>Left</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Mid</w:t></w:r><w:r><w:tab/></w:r>' +
      '<w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>9</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> of </w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t>1</w:t></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
  )
  const alignTab = part('ftr', '<w:p><w:r><w:t>A</w:t></w:r><w:r><w:ptab w:relativeTo="margin" w:alignment="right" w:leader="none"/></w:r><w:r><w:t>B</w:t></w:r></w:p>')
  const bytes = await makeDocx({
    styles,
    rels: [['rH', 'header', 'header1.xml'], ['rF', 'footer', 'footer1.xml'], ['rF1', 'footer', 'footer2.xml'], ['rL', 'hyperlink', 'https://example.com/x', true]],
    parts: { 'word/header1.xml': part('hdr', para('Running head')), 'word/footer1.xml': footer, 'word/footer2.xml': alignTab },
    body:
      para('Intro', '<w:pStyle w:val="Heading1"/>') +
      '<w:p><w:hyperlink r:id="rL"><w:r><w:t>web</w:t></w:r></w:hyperlink><w:hyperlink w:anchor="mark"><w:r><w:t>inside</w:t></w:r></w:hyperlink>' +
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://example.com/field" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>field</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
      para('Loose', '<w:widowControl w:val="0"/><w:outlineLvl w:val="1"/>') +
      '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rH"/><w:footerReference w:type="default" r:id="rF"/><w:footerReference w:type="first" r:id="rF1"/><w:titlePg/>' +
      '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="360" w:footer="540"/></w:sectPr></w:pPr></w:p>' +
      para('Second section') +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
  })
  const { sections } = await readDocx(bytes)
  expect(sections).toHaveLength(2)
  const [a, b] = sections
  expect(a.margins).toMatchObject({ header: 18, footer: 27, top: 72 })
  expect(a.titlePg).toBe(true)

  const [intro, links, loose] = a.blocks as Paragraph[]
  expect(intro).toMatchObject({ heading: 1, keepNext: true, keepLines: true })
  expect(loose).toMatchObject({ heading: 2, widowControl: false })
  expect(intro.widowControl).toBeUndefined()
  // an address outside the file, a place inside it (no link), and a field-coded address
  expect(links.runs.map((r) => [r.text, r.link])).toEqual([['web', 'https://example.com/x'], ['inside', undefined], ['field', 'https://example.com/field']])

  // the footer: tab stops from its style, one run for each page number whatever the file saved
  const [f] = a.footer as Paragraph[]
  expect(f.runs.map((r) => [r.text === '\t' ? 'TAB' : r.text, r.field])).toEqual([['Left', undefined], ['TAB', undefined], ['Mid', undefined], ['TAB', undefined], ['Page ', undefined], ['9', 'page'], [' of ', undefined], ['1', 'pages']])
  expect(f.tabs).toEqual([{ pos: 234, align: 'center' }, { pos: 468, align: 'right' }])
  expect(((a.header as Paragraph[])[0]).runs[0].text).toBe('Running head')
  expect((a.firstFooter as Paragraph[])[0].tabs).toEqual([{ align: 'right' }])
  // the second section names nothing, so it has the first one's
  expect(b.header).toEqual(a.header)
  expect(b.footer).toEqual(a.footer)
  expect(b.titlePg).toBeUndefined()
})

test('the fonts of a Word document include those of its headers and footers, most used first', async () => {
  const bytes = await makeDocx({
    rels: [['h', 'header', 'h.xml']],
    parts: { 'word/h.xml': part('hdr', '<w:p><w:r><w:rPr><w:rFonts w:ascii="Georgia"/></w:rPr><w:t>Running head</w:t></w:r></w:p>') },
    body: '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr><w:t>A longer body line</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="h"/></w:sectPr>',
  })
  expect(await usedFonts(bytes)).toEqual(['Calibri', 'Georgia'])
})

test('fonts stored in the file are read, with Word\'s scrambling undone and a key of zeros meaning none', async () => {
  const original = Uint8Array.from({ length: 80 }, (_, i) => (i * 7) % 251)
  const guid = '{00112233-4455-6677-8899-AABBCCDDEEFF}'
  // the first 32 bytes are what gets changed, with the GUID's bytes from the last one: FF EE DD ... 00
  const stored = scramble(original, guid)
  expect(stored[0]).toBe(original[0] ^ 0xff)
  expect(stored[16]).toBe(original[16] ^ 0xff)
  expect(stored[32]).toBe(original[32])
  const { fonts } = await readDocx(await withFonts([['Scrambled', stored, guid], ['Plain', original, '{00000000-0000-0000-0000-000000000000}']], para('x')))
  expect(fonts?.map((f) => [f.name, f.bold, f.italic, [...f.bytes]])).toEqual([['Scrambled', false, false, [...original]], ['Plain', false, false, [...original]]])
  // a family the file carries is not asked of the computer; one it doesn't is
  const text = (font: string) => `<w:p><w:r><w:rPr><w:rFonts w:ascii="${font}"/></w:rPr><w:t>hello</w:t></w:r></w:p>`
  expect(await usedFonts(await withFonts([['Plain', original, '{00000000-0000-0000-0000-000000000000}']], text('Plain') + text('Elsewhere')))).toEqual(['Elsewhere'])
})

test('a picture in a line is a run of its paragraph, with its crop (cut from the left, room added below)', async () => {
  const bytes = await makeDocx({ rels: [['pic', 'image', 'media/pic.png']], parts: { 'word/media/pic.png': PIXEL }, body: `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>a</w:t></w:r>${inline(100, 50, '<a:srcRect l="25000" b="-566667"/>')}</w:p>` })
  const [p] = (await readDocx(bytes)).sections[0].blocks as Paragraph[]
  expect(p.align).toBe('center')
  expect(p.runs.map((r) => r.text)).toEqual(['a', ''])
  expect(p.runs[1].picture).toMatchObject({ type: 'png', width: 100, height: 50, crop: { l: 0.25, t: 0, r: 0, b: -5.66667 } })
  // nothing absurd: a crop that leaves nothing of the picture is dropped
  const none = await makeDocx({ rels: [['pic', 'image', 'media/pic.png']], parts: { 'word/media/pic.png': PIXEL }, body: `<w:p>${inline(10, 10, '<a:srcRect l="60000" r="60000"/>')}</w:p>` })
  expect(((await readDocx(none)).sections[0].blocks[0] as Paragraph).runs[0].picture?.crop).toBeUndefined()
})
