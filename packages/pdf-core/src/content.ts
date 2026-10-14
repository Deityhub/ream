// Reading a page's content stream as a list of operators with their position in the bytes, so a rewriter can cut
// operators out and keep every other byte exactly as it was.
import { Parser } from './parser.ts'
import { PdfKeyword, PdfName, type PdfDict, type PdfObj } from './objects.ts'

export type ContentOp = {
  op: string
  args: PdfObj[]
  /** byte range of the operands and the operator together, [start, end) */
  start: number
  end: number
}

const isWs = (c: number | undefined) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0
const COMPONENTS: Record<string, number> = { G: 1, DeviceGray: 1, RGB: 3, DeviceRGB: 3, CMYK: 4, DeviceCMYK: 4, I: 1, Indexed: 1 }

/**
 * Skip the data of an inline image, given the parser just after `ID`. Returns the position just after `EI`, or -1 when
 * the image never ends. Unfiltered data has a known length, which is the safest way to find the end; for filtered data
 * we look for EI between whitespace followed by plausible text.
 */
function skipInlineData(d: Uint8Array, from: number, dict: PdfDict): number {
  let start = from
  if (d[start] === 13 && d[start + 1] === 10) start += 2
  else if (isWs(d[start])) start++
  let at = start
  if (!(dict.has('Filter') || dict.has('F'))) {
    const w = Number(dict.get('Width') ?? dict.get('W')) || 0
    const h = Number(dict.get('Height') ?? dict.get('H')) || 0
    const mask = (dict.get('ImageMask') ?? dict.get('IM')) === true
    const bpc = mask ? 1 : Number(dict.get('BitsPerComponent') ?? dict.get('BPC')) || 8
    const cs = dict.get('ColorSpace') ?? dict.get('CS')
    const first = Array.isArray(cs) ? cs[0] : cs
    const n = mask ? 1 : first instanceof PdfName ? COMPONENTS[first.value] : undefined
    if (n) at = start + ((w * n * bpc + 7) >> 3) * h
  }
  for (; at < d.length - 1; at++) {
    if (d[at] === 69 && d[at + 1] === 73 && (at === start || isWs(d[at - 1])) && (at + 2 >= d.length || isWs(d[at + 2]))) {
      if (d.subarray(at + 2, at + 12).every((c) => c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127))) return at + 2
    }
  }
  return -1
}

/** every operator in the stream, in order. Unreadable bytes are skipped, as the renderer does. */
export function scanContent(data: Uint8Array): ContentOp[] {
  const p = new Parser(data)
  const ops: ContentOp[] = []
  let args: PdfObj[] = []
  let argStart = -1
  for (;;) {
    p.skipWs()
    if (p.pos >= data.length) break
    const before = p.pos
    let v: PdfObj | PdfKeyword
    try {
      v = p.readValue()
    } catch {
      p.pos = before + 1
      args = []
      argStart = -1
      continue
    }
    if (!(v instanceof PdfKeyword)) {
      if (!args.length) argStart = before
      args.push(v)
      continue
    }
    const start = args.length ? argStart : before
    if (v.value === 'BI') {
      const dict: PdfDict = new Map()
      for (;;) {
        const k = p.readValue()
        if (k instanceof PdfKeyword) {
          if (k.value === 'ID') break
          continue
        }
        if (!(k instanceof PdfName)) continue
        const val = p.readValue()
        if (val instanceof PdfKeyword) break
        dict.set(k.value, val)
      }
      const end = skipInlineData(data, p.pos, dict)
      p.pos = end < 0 ? data.length : end
      ops.push({ op: 'BI', args: [dict], start, end: p.pos })
    } else {
      ops.push({ op: v.value, args, start, end: p.pos })
    }
    args = []
    argStart = -1
  }
  return ops
}

export type UsedResources = {
  /** resource kind ("Font", "XObject", ...) to the names a stream uses from it */
  names: Record<string, Set<string>>
  /** inline images can name colour spaces from the resources inside their own dictionary */
  inlineImages: boolean
}

const DEVICE = new Set(['DeviceGray', 'DeviceRGB', 'DeviceCMYK', 'Pattern'])

/** which resources the operators refer to by name */
export function usedResources(ops: ContentOp[]): UsedResources {
  const names: Record<string, Set<string>> = {}
  let inlineImages = false
  const use = (kind: string, a: PdfObj | undefined) => {
    if (a instanceof PdfName) (names[kind] ??= new Set()).add(a.value)
  }
  for (const { op, args } of ops) {
    if (op === 'Do') use('XObject', args[0])
    else if (op === 'Tf') use('Font', args[0])
    else if (op === 'gs') use('ExtGState', args[0])
    else if (op === 'sh') use('Shading', args[0])
    else if ((op === 'cs' || op === 'CS') && !(args[0] instanceof PdfName && DEVICE.has(args[0].value))) use('ColorSpace', args[0])
    else if (op === 'scn' || op === 'SCN') use('Pattern', args[args.length - 1])
    else if (op === 'BDC' || op === 'DP') use('Properties', args[1])
    else if (op === 'BI') inlineImages = true
  }
  return { names, inlineImages }
}
