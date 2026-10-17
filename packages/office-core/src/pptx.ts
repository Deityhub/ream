// Write a presentation (.pptx) from a Deck: one blank layout, slides made of text boxes, pictures, lines and tables.
import { zipPacked } from '@ream/core'
import type { Deck, Slide, SlideBox, SlidePara, SlideRun, SlideShape, SlideTable } from './pptx-model.ts'
import { esc } from './xml.ts'

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`
const emu = (pt: number) => Math.round(pt * 12700)
const hundred = (pt: number) => Math.round(pt * 100)
const MAX_EMU = 51206400 // PowerPoint's largest slide side (56 inches)

const xfrm = (x: number, y: number, w: number, h: number, rot?: number, tag = 'a:xfrm') =>
  `<${tag}${rot ? ` rot="${Math.round(rot * 60000)}"` : ''}><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></${tag}>`
const solid = (hex: string) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`

function runXml(r: SlideRun): string {
  if (!r.text) return ''
  const font = r.font ? `<a:latin typeface="${esc(r.font)}"/><a:cs typeface="${esc(r.font)}"/>` : ''
  const fill = r.color ? solid(r.color) : ''
  const attrs = `lang="en-GB"${r.size ? ` sz="${hundred(r.size)}"` : ''}${r.bold ? ' b="1"' : ''}${r.italic ? ' i="1"' : ''}${r.underline ? ' u="sng"' : ''} dirty="0"`
  // line breaks inside a run are <a:br/> between runs
  return r.text.split('\n').map((t, i) => `${i ? `<a:br><a:rPr ${attrs}/></a:br>` : ''}${t ? `<a:r><a:rPr ${attrs}>${fill}${font}</a:rPr><a:t>${esc(t)}</a:t></a:r>` : ''}`).join('')
}

function paraXml(p: SlidePara): string {
  const spacing =
    `${p.line ? `<a:lnSpc><a:spcPts val="${hundred(p.line)}"/></a:lnSpc>` : p.lineFactor ? `<a:lnSpc><a:spcPct val="${Math.round(p.lineFactor * 100000)}"/></a:lnSpc>` : ''}` +
    `${p.before !== undefined ? `<a:spcBef><a:spcPts val="${hundred(p.before)}"/></a:spcBef>` : ''}${p.after !== undefined ? `<a:spcAft><a:spcPts val="${hundred(p.after)}"/></a:spcAft>` : ''}`
  const bullet = p.bullet ? (p.bullet === 'number' ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>' : `<a:buFont typeface="Arial"/><a:buChar char="${esc(p.bullet)}"/>`) : '<a:buNone/>'
  const attrs = `${p.marginLeft ? ` marL="${emu(p.marginLeft)}"` : ''}${p.indent ? ` indent="${emu(p.indent)}"` : ''} algn="${p.align === 'center' ? 'ctr' : p.align === 'right' ? 'r' : p.align === 'justify' ? 'just' : 'l'}"`
  const end = p.size ? `<a:endParaRPr lang="en-GB" sz="${hundred(p.size)}" dirty="0"/>` : ''
  return `<a:p><a:pPr${attrs}>${spacing}${bullet}</a:pPr>${p.runs.map(runXml).join('')}${end}</a:p>`
}

const body = (paras: SlidePara[]) => (paras.length ? paras : [{ runs: [] }]).map(paraXml).join('')

function boxXml(b: SlideBox, id: number): string {
  const [l, t, r, bt] = b.insets ?? [0, 0, 0, 0]
  const anchor = b.anchor === 'middle' ? 'ctr' : b.anchor === 'bottom' ? 'b' : 't'
  const line = b.line ? `<a:ln w="${emu(b.line.width)}">${solid(b.line.color)}</a:ln>` : '<a:ln><a:noFill/></a:ln>'
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(b.name ?? `Text ${id}`)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(b.x, b.y, b.w, b.h, b.rotation)}<a:prstGeom prst="${b.geometry ?? 'rect'}"><a:avLst/></a:prstGeom>${b.fill ? solid(b.fill) : '<a:noFill/>'}${line}</p:spPr><p:txBody><a:bodyPr wrap="${b.wrap === false ? 'none' : 'square'}" lIns="${emu(l)}" tIns="${emu(t)}" rIns="${emu(r)}" bIns="${emu(bt)}" rtlCol="0" anchor="${anchor}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${body(b.paragraphs)}</p:txBody></p:sp>`
}

function tableXml(t: SlideTable, id: number): string {
  const line = (n: string, on: boolean) => (on ? `<a:${n} w="6350">${solid('000000')}</a:${n}>` : `<a:${n} w="0"><a:noFill/></a:${n}>`)
  const rows = t.cells
    .map((row, ri) => {
      const cells = row
        .map((c) => {
          const attrs = `${c.cols && c.cols > 1 ? ` gridSpan="${c.cols}"` : ''}${c.rows && c.rows > 1 ? ` rowSpan="${c.rows}"` : ''}${c.covered?.includes('h') ? ' hMerge="1"' : ''}${c.covered?.includes('v') ? ' vMerge="1"' : ''}`
          const anchor = c.anchor === 'middle' ? 'ctr' : c.anchor === 'bottom' ? 'b' : 't'
          const b = !!c.border
          return `<a:tc${attrs}><a:txBody><a:bodyPr/><a:lstStyle/>${body(c.paragraphs)}</a:txBody><a:tcPr marL="${emu(3)}" marR="${emu(3)}" marT="${emu(2)}" marB="${emu(2)}" anchor="${anchor}">${line('lnL', b)}${line('lnR', b)}${line('lnT', b)}${line('lnB', b)}${c.fill ? solid(c.fill) : '<a:noFill/>'}</a:tcPr></a:tc>`
        })
        .join('')
      return `<a:tr h="${emu(t.rowHeights[ri] ?? 14)}">${cells}</a:tr>`
    })
    .join('')
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm(t.x, t.y, t.w, t.h, undefined, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${t.colWidths.map((w) => `<a:gridCol w="${emu(w)}"/>`).join('')}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

type Media = { name: string; bytes: Uint8Array; ext: string }

function slideXml(s: Slide, media: Media[], rels: string[]): string {
  let id = 1
  const shapes = s.shapes
    .map((sh: SlideShape) => {
      const n = ++id
      if (sh.kind === 'unsupported') return ''
      if (sh.kind === 'text') return boxXml(sh, n)
      if (sh.kind === 'table') return tableXml(sh, n)
      if (sh.kind === 'line') {
        const flipH = sh.x1 < sh.x0
        const flipV = sh.y1 < sh.y0
        return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${n}" name="Line ${n}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flipH ? ' flipH="1"' : ''}${flipV ? ' flipV="1"' : ''}><a:off x="${emu(Math.min(sh.x0, sh.x1))}" y="${emu(Math.min(sh.y0, sh.y1))}"/><a:ext cx="${emu(Math.abs(sh.x1 - sh.x0))}" cy="${emu(Math.abs(sh.y1 - sh.y0))}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="${emu(sh.width)}">${solid(sh.color)}</a:ln></p:spPr></p:cxnSp>`
      }
      if (sh.type === 'other') return ''
      const m: Media = { name: `image${media.length + 1}.${sh.type === 'png' ? 'png' : 'jpeg'}`, bytes: sh.bytes, ext: sh.type === 'png' ? 'png' : 'jpeg' }
      media.push(m)
      const rid = `rId${rels.length + 2}` // rId1 is the layout
      rels.push(`<Relationship Id="${rid}" Type="${R}/image" Target="../media/${m.name}"/>`)
      const crop = sh.crop ? `<a:srcRect l="${Math.round(sh.crop[0] * 100000)}" t="${Math.round(sh.crop[1] * 100000)}" r="${Math.round(sh.crop[2] * 100000)}" b="${Math.round(sh.crop[3] * 100000)}"/>` : ''
      return `<p:pic><p:nvPicPr><p:cNvPr id="${n}" name="Picture ${n}" descr="${esc(sh.alt ?? '')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(sh.x, sh.y, sh.w, sh.h, sh.rotation)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    })
    .join('')
  const bg = s.background ? `<p:bg><p:bgPr>${solid(s.background)}<a:effectLst/></p:bgPr></p:bg>` : ''
  return `${HEAD}<p:sld ${NS}${s.hidden ? ' show="0"' : ''}><p:cSld>${bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

const EMPTY_TREE = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>'
const MASTER = `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr algn="l"><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr algn="l"><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`
const LAYOUT = `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
const fill3 = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
const THEME = `${HEAD}<a:theme xmlns:a="${A}" name="Ream"><a:themeElements><a:clrScheme name="Ream"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Ream"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Ream"><a:fillStyleLst>${fill3}${fill3}${fill3}</a:fillStyleLst><a:lnStyleLst>${[1, 2, 3].map(() => `<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr">${fill3}<a:prstDash val="solid"/></a:ln>`).join('')}</a:lnStyleLst><a:effectStyleLst>${[1, 2, 3].map(() => '<a:effectStyle><a:effectLst/></a:effectStyle>').join('')}</a:effectStyleLst><a:bgFillStyleLst>${fill3}${fill3}${fill3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`

/** the file for a deck */
export async function writePptx(deck: Deck): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const media: Media[] = []
  const slides = deck.slides.map((s) => {
    const rels: string[] = []
    const xml = slideXml(s, media, rels)
    return { xml, rels: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${rels.join('')}</Relationships>` }
  })
  const cx = Math.min(MAX_EMU, emu(deck.width))
  const cy = Math.min(MAX_EMU, emu(deck.height))
  const exts = [...new Set(media.map((m) => m.ext))]
  const ct = (part: string, type: string) => `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`
  const files = [
    { name: '[Content_Types].xml', text: `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}${ct('/ppt/presentation.xml', 'presentation.main')}${ct('/ppt/slideMasters/slideMaster1.xml', 'slideMaster')}${ct('/ppt/slideLayouts/slideLayout1.xml', 'slideLayout')}${slides.map((_, i) => ct(`/ppt/slides/slide${i + 1}.xml`, 'slide')).join('')}<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', text: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: 'docProps/core.xml', text: `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(deck.title ?? '')}</dc:title><dc:creator>Ream</dc:creator></cp:coreProperties>` },
    { name: 'ppt/presentation.xml', text: `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', text: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="${R}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>` },
    { name: 'ppt/slideMasters/slideMaster1.xml', text: MASTER },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', text: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${R}/theme" Target="../theme/theme1.xml"/></Relationships>` },
    { name: 'ppt/slideLayouts/slideLayout1.xml', text: LAYOUT },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', text: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>` },
    { name: 'ppt/theme/theme1.xml', text: THEME },
    ...slides.flatMap((s, i) => [{ name: `ppt/slides/slide${i + 1}.xml`, text: s.xml }, { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, text: s.rels }]),
  ].map((f) => ({ name: f.name, bytes: enc.encode(f.text) }))
  return zipPacked([...files, ...media.map((m) => ({ name: `ppt/media/${m.name}`, bytes: m.bytes }))])
}
