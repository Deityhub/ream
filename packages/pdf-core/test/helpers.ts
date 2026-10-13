import { PdfDocument, PdfStream, decodeStream, deflate, isName } from '../src/index.ts'
import { ascii, concat, latin1 } from '../src/bytes.ts'

type Obj = [num: number, body: string]

const stream = (content: string, length = content.length) => `<< /Length ${length} >>\nstream\n${content}\nendstream`

/** objects for a PDF whose page i shows the text texts[i]: 1 catalog, 2 pages, 3 font, then page+content pairs */
function objectsFor(texts: string[]): Obj[] {
  const pageNum = (i: number) => 4 + 2 * i
  const objs: Obj[] = [
    [1, '<< /Type /Catalog /Pages 2 0 R >>'],
    [2, `<< /Type /Pages /Kids [${texts.map((_, i) => `${pageNum(i)} 0 R`).join(' ')}] /Count ${texts.length} >>`],
    [3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
  ]
  texts.forEach((t, i) => {
    objs.push([pageNum(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageNum(i) + 1} 0 R >>`])
    objs.push([pageNum(i) + 1, stream(`BT /F1 12 Tf 20 100 Td (${t}) Tj ET`)])
  })
  return objs
}

export function assemble(objs: Obj[], extraTrailer = '') {
  let out = '%PDF-1.4\n'
  const offsets = new Map<number, number>()
  for (const [num, body] of objs) {
    offsets.set(num, out.length)
    out += `${num} 0 obj\n${body}\nendobj\n`
  }
  const size = Math.max(...offsets.keys()) + 1
  const xref = out.length
  out += `xref\n0 ${size}\n0000000000 65535 f \n`
  for (let n = 1; n < size; n++) out += `${String(offsets.get(n) ?? 0).padStart(10, '0')} 00000 ${offsets.has(n) ? 'n' : 'f'} \n`
  out += `trailer\n<< /Size ${size} /Root 1 0 R ${extraTrailer} >>\nstartxref\n${xref}\n%%EOF\n`
  return { bytes: ascii(out), xref, text: out }
}

export const classicPdf = (texts: string[]) => assemble(objectsFor(texts)).bytes

/** a stream whose /Length lies, so the parser must scan for endstream */
export function wrongLengthPdf(texts: string[]) {
  const objs = objectsFor(texts).map(([n, b]): Obj => (b.includes('stream\n') ? [n, b.replace(/\/Length \d+/, '/Length 3')] : [n, b]))
  return assemble(objs).bytes
}

/** valid objects but startxref points at nowhere, forcing the scan-based rebuild */
export function brokenXrefPdf(texts: string[]) {
  return ascii(assemble(objectsFor(texts)).text.replace(/startxref\n\d+/, 'startxref\n99999'))
}

export const encryptedPdf = (texts: string[]) => assemble(objectsFor(texts), '/Encrypt << /Filter /Standard /V 1 /R 2 >>').bytes

/** base file with one page "Old", then an update appended that replaces its content with "New" */
export function incrementalPdf() {
  const base = assemble(objectsFor(['Old']))
  let tail = ''
  const at = base.bytes.length
  tail += `5 0 obj\n${stream('BT /F1 12 Tf 20 100 Td (New) Tj ET')}\nendobj\n`
  const x = at + tail.length
  tail += `xref\n5 1\n${String(at).padStart(10, '0')} 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R /Prev ${base.xref} >>\nstartxref\n${x}\n%%EOF\n`
  return concat([base.bytes, ascii(tail)])
}

/** pages, catalog, font in a compressed object stream, xref as a PNG-predicted xref stream */
export async function xrefStreamPdf(texts: string[]): Promise<Uint8Array> {
  const objs = objectsFor(texts)
  const inStm = objs.filter(([, b]) => !b.includes('stream\n'))
  const direct = objs.filter(([, b]) => b.includes('stream\n'))
  const stmNum = objs.length + 1
  const xrefNum = objs.length + 2
  let head = ''
  let body = ''
  for (const [n, b] of inStm) {
    head += `${n} ${body.length} `
    body += b + '\n'
  }
  const stmData = await deflate(ascii(head + body))

  const chunks: Uint8Array[] = []
  let len = 0
  const push = (x: string | Uint8Array) => {
    const b = typeof x === 'string' ? ascii(x) : x
    chunks.push(b)
    len += b.length
  }
  push('%PDF-1.5\n')
  const offsets = new Map<number, number>()
  for (const [n, b] of direct) {
    offsets.set(n, len)
    push(`${n} 0 obj\n${b}\nendobj\n`)
  }
  offsets.set(stmNum, len)
  push(`${stmNum} 0 obj\n<< /Type /ObjStm /N ${inStm.length} /First ${head.length} /Filter /FlateDecode /Length ${stmData.length} >>\nstream\n`)
  push(stmData)
  push('\nendstream\nendobj\n')
  offsets.set(xrefNum, len)

  // rows: [type, field2 (4 bytes), field3 (2 bytes)], encoded with PNG "Up" filter
  const rows: number[][] = []
  for (let n = 0; n <= xrefNum; n++) {
    const i = inStm.findIndex(([m]) => m === n)
    const [t, f2, f3] = n === 0 ? [0, 0, 0] : i >= 0 ? [2, stmNum, i] : [1, offsets.get(n)!, 0]
    rows.push([t, (f2 >>> 24) & 255, (f2 >>> 16) & 255, (f2 >>> 8) & 255, f2 & 255, (f3 >> 8) & 255, f3 & 255])
  }
  const filtered = rows.flatMap((row, r) => [2, ...row.map((v, c) => (v - (r ? rows[r - 1][c] : 0) + 256) & 255)])
  const xrefData = await deflate(Uint8Array.from(filtered))
  push(`${xrefNum} 0 obj\n<< /Type /XRef /Size ${xrefNum + 1} /Root 1 0 R /W [1 4 2] /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> /Length ${xrefData.length} >>\nstream\n`)
  push(xrefData)
  push(`\nendstream\nendobj\nstartxref\n${offsets.get(xrefNum)}\n%%EOF\n`)
  return concat(chunks)
}

/** text shown on each page, read back through our own parser (handles Flate content streams) */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await PdfDocument.load(bytes)
  const out: string[] = []
  for (const page of doc.pages()) {
    const parts = [doc.resolve(page.dict.get('Contents'))].flat().map((c) => doc.resolve(c))
    let text = ''
    for (const c of parts) if (c instanceof PdfStream) text += latin1(await decodeStream(c))
    out.push([...text.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).join(''))
  }
  return out
}

export { isName }
