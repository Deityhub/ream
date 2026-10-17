// Write a document (.docx) from a DocModel: paragraphs and runs with direct formatting, headings, bullets, tables, pictures
// (in the flow or behind the text) and one section per page size.
import { zipPacked } from '@ream/core'
import type { Block, DocModel, Paragraph, Picture, Run, Section, Table } from './docx-model.ts'
import { esc, fmt } from './xml.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const tw = (pt: number) => Math.round(pt * 20)
const emu = (pt: number) => Math.round(pt * 12700)

const runXml = (r: Run): string => {
  const font = r.font ? `<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:cs="${esc(r.font)}"/>` : ''
  const props = `${font}${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}${r.color ? `<w:color w:val="${r.color}"/>` : ''}${r.size ? `<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>` : ''}${r.underline ? '<w:u w:val="single"/>' : ''}`
  // a line break inside a run is a <w:br/>, a tab a <w:tab/>
  const body = r.text.split(/(\n|\t)/).map((t) => (t === '\n' ? '<w:br/>' : t === '\t' ? '<w:tab/>' : t ? `<w:t xml:space="preserve">${esc(t)}</w:t>` : '')).join('')
  return body ? `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${body}</w:r>` : ''
}

class Package {
  images: { name: string; bytes: Uint8Array; ext: string; id: string }[] = []
  addImage(p: Picture): string {
    const n = this.images.length + 1
    const ext = p.type === 'png' ? 'png' : 'jpeg'
    const id = `rIdImg${n}`
    this.images.push({ name: `image${n}.${ext}`, bytes: p.bytes, ext, id })
    return id
  }
}

function pictureXml(p: Picture, pkg: Package, docPrId: number): string {
  const id = pkg.addImage(p)
  const [cx, cy] = [emu(p.width), emu(p.height)]
  const graphic = `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="Picture ${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`
  const doc = `<wp:docPr id="${docPrId}" name="Picture ${docPrId}" descr="${esc(p.alt ?? '')}"/>`
  if (!p.at) return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>${doc}<wp:cNvGraphicFramePr/>${graphic}</wp:inline></w:drawing>`
  return `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(p.at.x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${emu(p.at.y)}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>${doc}<wp:cNvGraphicFramePr/>${graphic}</wp:anchor></w:drawing>`
}

function paragraphXml(p: Paragraph, extra = '', sectPr = ''): string {
  const spacing = p.before || p.after || p.line ? `<w:spacing${p.before ? ` w:before="${tw(p.before)}"` : ''}${p.after !== undefined ? ` w:after="${tw(p.after)}"` : ''}${p.line ? ` w:line="${tw(p.line)}" w:lineRule="atLeast"` : ''}/>` : ''
  const ind = p.indentLeft || p.indentFirst ? `<w:ind${p.indentLeft ? ` w:left="${tw(p.indentLeft)}"` : ''}${p.indentFirst ? (p.indentFirst < 0 ? ` w:hanging="${tw(-p.indentFirst)}"` : ` w:firstLine="${tw(p.indentFirst)}"`) : ''}/>` : ''
  const jc = p.align && p.align !== 'left' ? `<w:jc w:val="${p.align === 'justify' ? 'both' : p.align}"/>` : ''
  const props = `${p.heading ? `<w:pStyle w:val="Heading${p.heading}"/>` : ''}${p.pageBreakBefore ? '<w:pageBreakBefore/>' : ''}${p.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}${spacing}${ind}${jc}${sectPr}`
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${extra}${p.runs.map(runXml).join('')}</w:p>`
}

function tableXml(t: Table): string {
  const line = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`
  const borders = t.borders ? `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(line).join('')}</w:tblBorders>` : ''
  const total = t.colWidths.reduce((a, b) => a + b, 0)
  const grid = t.colWidths.map((w) => `<w:gridCol w:w="${tw(w)}"/>`).join('')
  const rows = t.rows
    .map((row, ri) => {
      let col = 0
      const cells = row.map((c) => {
        const span = c.cols ?? 1
        const w = t.colWidths.slice(col, col + span).reduce((a, b) => a + b, 0)
        col += span
        const pr = `<w:tcW w:w="${tw(w)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${c.vMerge === 'restart' ? '<w:vMerge w:val="restart"/>' : c.vMerge === 'continue' ? '<w:vMerge/>' : ''}${c.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/>` : ''}`
        const paras = c.paragraphs.length ? c.paragraphs : [{ kind: 'p' as const, runs: [] }]
        return `<w:tc><w:tcPr>${pr}</w:tcPr>${paras.map((p) => paragraphXml(p)).join('')}</w:tc>`
      })
      const h = t.rowHeights?.[ri]
      return `<w:tr><w:trPr><w:cantSplit/>${h ? `<w:trHeight w:val="${tw(h)}" w:hRule="atLeast"/>` : ''}</w:trPr>${cells.join('')}</w:tr>`
    })
    .join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="${tw(total)}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`
}

function sectPr(s: Section): string {
  const m = s.margins
  return `<w:sectPr><w:pgSz w:w="${tw(s.width)}" w:h="${tw(s.height)}"${s.width > s.height ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(m.top)}" w:right="${tw(m.right)}" w:bottom="${tw(m.bottom)}" w:left="${tw(m.left)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`
}

function blockXml(b: Block, pkg: Package, ids: { n: number }): string {
  if (b.kind === 'p') return paragraphXml(b)
  // Word wants a paragraph after a table; it is one point high and carries the space below the table
  if (b.kind === 'table') return tableXml(b) + `<w:p><w:pPr><w:spacing w:before="${tw(b.after ?? 0)}" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`
  const pic = pictureXml(b, pkg, ++ids.n)
  // a picture behind the text sits in a one-point paragraph so it adds nothing to the page
  return b.at ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr>${pic}</w:r></w:p>` : `<w:p><w:r>${pic}</w:r></w:p>`
}

const STYLES = `${HEAD}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${[1, 2, 3, 4, 5, 6].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>`).join('')}<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`

const NUMBERING = `${HEAD}<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`

/** the file for a document */
export async function writeDocx(doc: DocModel): Promise<Uint8Array> {
  const pkg = new Package()
  const ids = { n: 0 }
  let body = ''
  doc.sections.forEach((s, i) => {
    const last = i === doc.sections.length - 1
    const parts = s.blocks.map((b) => blockXml(b, pkg, ids))
    // a section ends with a paragraph that carries its properties (the last section's go at the end of the body): the section's
    // own last paragraph when it has one, else a one-point paragraph
    if (!last) {
      const tail = s.blocks[s.blocks.length - 1]
      if (tail?.kind === 'p') parts[parts.length - 1] = paragraphXml(tail, '', sectPr(s))
      else parts.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${sectPr(s)}</w:pPr></w:p>`)
    }
    body += parts.join('')
  })
  const lastSection = doc.sections[doc.sections.length - 1]
  const document = `${HEAD}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}${lastSection ? sectPr(lastSection) : ''}</w:body></w:document>`
  const enc = new TextEncoder()
  const exts = [...new Set(pkg.images.map((i) => i.ext))]
  const files = [
    { name: '[Content_Types].xml', text: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', text: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', text: `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(doc.title ?? '')}</dc:title><dc:creator>Ream</dc:creator></cp:coreProperties>` },
    { name: 'word/document.xml', text: document },
    { name: 'word/styles.xml', text: STYLES },
    { name: 'word/numbering.xml', text: NUMBERING },
    { name: 'word/_rels/document.xml.rels', text: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="${R}/numbering" Target="numbering.xml"/>${pkg.images.map((i) => `<Relationship Id="${i.id}" Type="${R}/image" Target="media/${i.name}"/>`).join('')}</Relationships>` },
  ].map((f) => ({ name: f.name, bytes: enc.encode(f.text) }))
  return zipPacked([...files, ...pkg.images.map((i) => ({ name: `word/media/${i.name}`, bytes: i.bytes }))])
}
