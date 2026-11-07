// A small .docx made from XML strings, for tests that need what a real file has and the fixtures don't (headers, fields, links).
import { zipPacked } from '@ream/core'

export const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const enc = (s: string) => new TextEncoder().encode(s)

/**
 * `body` goes inside w:body (its last w:sectPr is the document's); `rels` are the document's relationships (id, type name,
 * target, external); `parts` are other files by name, written as they are (a header is `<w:hdr ${NS}>...`: use `part()`).
 */
export async function makeDocx(o: { body: string; styles?: string; rels?: [id: string, type: string, target: string, external?: boolean][]; parts?: Record<string, string | Uint8Array> }): Promise<Uint8Array> {
  const rels = (o.rels ?? []).map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`)
  if (o.styles) rels.push(`<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>`)
  const files: Record<string, string | Uint8Array> = {
    '_rels/.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
    'word/document.xml': `<?xml version="1.0"?><w:document ${NS}><w:body>${o.body}</w:body></w:document>`,
    ...(o.styles ? { 'word/styles.xml': `<?xml version="1.0"?><w:styles ${NS}>${o.styles}</w:styles>` } : {}),
    ...o.parts,
  }
  return zipPacked(Object.entries(files).map(([name, data]) => ({ name, bytes: typeof data === 'string' ? enc(data) : data })))
}

/** a 1 x 1 PNG, for pictures that only need to be there */
export const PIXEL = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

/** a picture placed in the page: `size` points square at (`x`, `y`) points from the column and the paragraph, text going `wrap` it, 9 points clear all round; rel id `pic` must be in the document's relationships */
export const placed = (wrap: 'square' | 'topBottom', size = 144, x = 0, y = 0) =>
  `<w:r><w:drawing><wp:anchor distT="114300" distB="114300" distL="114300" distR="114300" behindDoc="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
  `<wp:positionH relativeFrom="column"><wp:posOffset>${x * 12700}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>${y * 12700}</wp:posOffset></wp:positionV>` +
  `<wp:extent cx="${size * 12700}" cy="${size * 12700}"/>${wrap === 'square' ? '<wp:wrapSquare wrapText="bothSides"/>' : '<wp:wrapTopAndBottom/>'}` +
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="pic"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`

/**
 * a document that carries fonts: `fonts` are [family, file bytes as stored, the GUID key written for it] for the regular face.
 * What Word does to a font before storing it (mixing its first 32 bytes with the reversed GUID) is `scramble`.
 */
export async function withFonts(fonts: [string, Uint8Array, string][], body: string): Promise<Uint8Array> {
  const table = fonts.map(([name, , guid], i) => `<w:font w:name="${name}"><w:embedRegular r:id="rId${i + 1}" w:fontKey="${guid}"/></w:font>`).join('')
  return makeDocx({
    body,
    rels: [['rFt', 'fontTable', 'fontTable.xml']],
    parts: {
      'word/fontTable.xml': `<?xml version="1.0"?><w:fonts ${NS}>${table}</w:fonts>`,
      'word/_rels/fontTable.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fonts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/font" Target="fonts/f${i}.odttf"/>`).join('')}</Relationships>`,
      ...Object.fromEntries(fonts.map(([, bytes], i) => [`word/fonts/f${i}.odttf`, bytes])),
    },
  })
}

/** the 32 bytes at the start of a font mixed with a GUID the way Word does it (the GUID's bytes taken from the end); doing it again undoes it */
export function scramble(bytes: Uint8Array, guid: string): Uint8Array {
  const hex = guid.replace(/[^0-9a-f]/gi, '')
  const key = (hex.match(/../g) ?? []).map((h) => parseInt(h, 16)).reverse()
  const out = bytes.slice()
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= key[i % 16]
  return out
}

/** a picture in a line of text, `w` by `h` points; rel id `pic` must be in the document's relationships */
export const inline = (w: number, h = w, srcRect = '') =>
  `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
  `<wp:extent cx="${Math.round(w * 12700)}" cy="${Math.round(h * 12700)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="pic"/>${srcRect}</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`

/** a header or footer part: `kind` is 'hdr' or 'ftr' */
export const part = (kind: 'hdr' | 'ftr', inner: string) => `<?xml version="1.0"?><w:${kind} ${NS}>${inner}</w:${kind}>`

/** a paragraph of plain runs */
export const para = (text: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
