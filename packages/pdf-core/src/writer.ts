import { PdfName, PdfRef, PdfStream, PdfString, isName, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'
import { ascii, concat } from './bytes.ts'

class Sink {
  chunks: Uint8Array[] = []
  length = 0
  push(x: string | Uint8Array) {
    const b = typeof x === 'string' ? ascii(x) : x
    this.chunks.push(b)
    this.length += b.length
  }
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  const s = n.toFixed(10).replace(/\.?0+$/, '')
  return s === '-0' ? '0' : s
}

function fmtName(v: string): string {
  let out = '/'
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i) & 255
    const plain = c > 0x20 && c < 0x7f && c !== 35 && !'()<>[]{}/%'.includes(String.fromCharCode(c))
    out += plain ? String.fromCharCode(c) : '#' + c.toString(16).padStart(2, '0').toUpperCase()
  }
  return out
}

function emit(s: Sink, o: PdfObj): void {
  if (o === null) s.push('null')
  else if (typeof o === 'boolean') s.push(o ? 'true' : 'false')
  else if (typeof o === 'number') s.push(fmtNum(o))
  else if (o instanceof PdfName) s.push(fmtName(o.value))
  else if (o instanceof PdfRef) s.push(`${o.num} ${o.gen} R`)
  else if (o instanceof PdfString) {
    if (o.hex) {
      s.push('<' + Array.from(o.bytes, (b) => b.toString(16).padStart(2, '0')).join('') + '>')
    } else {
      const out: number[] = [40]
      for (const b of o.bytes) {
        if (b === 40 || b === 41 || b === 92) out.push(92, b)
        else if (b === 13) out.push(92, 114)
        else if (b === 10) out.push(92, 110)
        else out.push(b)
      }
      out.push(41)
      s.push(Uint8Array.from(out))
    }
  } else if (Array.isArray(o)) {
    s.push('[')
    o.forEach((x, i) => {
      if (i) s.push(' ')
      emit(s, x)
    })
    s.push(']')
  } else if (o instanceof PdfStream) {
    const d = new Map(o.dict)
    d.set('Length', o.data.length)
    emit(s, d)
    s.push('\nstream\n')
    s.push(o.data)
    s.push('\nendstream')
  } else {
    s.push('<<')
    for (const [k, v] of o) {
      s.push(fmtName(k) + ' ')
      emit(s, v)
      s.push(' ')
    }
    s.push('>>')
  }
}

/** Collects objects (numbered 1..n in creation order) and writes them as a classic-xref PDF. */
export class PdfBuilder {
  objects: (PdfObj | undefined)[] = []

  /** allocate an object number now, fill it later (needed for reference cycles) */
  reserve(): PdfRef {
    this.objects.push(undefined)
    return new PdfRef(this.objects.length)
  }

  set(ref: PdfRef, obj: PdfObj) {
    this.objects[ref.num - 1] = obj
  }

  add(obj: PdfObj): PdfRef {
    const ref = this.reserve()
    this.set(ref, obj)
    return ref
  }

  serialize(root: PdfRef, info?: PdfRef): Uint8Array {
    const s = new Sink()
    s.push('%PDF-1.7\n')
    s.push(Uint8Array.of(37, 0xe2, 0xe3, 0xcf, 0xd3, 10))
    const offsets: number[] = []
    this.objects.forEach((o, i) => {
      offsets.push(s.length)
      s.push(`${i + 1} 0 obj\n`)
      emit(s, o ?? null)
      s.push('\nendobj\n')
    })
    const xref = s.length
    s.push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`)
    for (const off of offsets) s.push(String(off).padStart(10, '0') + ' 00000 n \n')
    s.push(`trailer\n<< /Size ${offsets.length + 1} /Root ${root.num} 0 R`)
    if (info) s.push(` /Info ${info.num} 0 R`)
    s.push(` >>\nstartxref\n${xref}\n%%EOF\n`)
    return concat(s.chunks)
  }
}

/** every ref points at generation 0 in a file we write */
const zeroGen = (o: PdfObj): PdfObj =>
  o instanceof PdfRef
    ? new PdfRef(o.num, 0)
    : Array.isArray(o)
      ? o.map(zeroGen)
      : o instanceof Map
        ? new Map([...o].map(([k, v]) => [k, zeroGen(v)] as [string, PdfObj]))
        : o instanceof PdfStream
          ? new PdfStream(zeroGen(o.dict) as Map<string, PdfObj>, o.data)
          : o

/**
 * Write a loaded document back out as it is: same objects, same numbers, but a plain classic-xref file. For an
 * encrypted source the objects are already decrypted, so this is the decrypted copy. Object and xref streams are
 * dropped (their contents are ordinary objects now).
 */
export function serializeDocument(doc: PdfDocument): Uint8Array {
  const root = doc.trailer.get('Root')
  if (!(root instanceof PdfRef)) throw new Error('The document has no catalog')
  const b = new PdfBuilder()
  const max = Math.max(0, ...doc.objects.keys())
  for (let n = 1; n <= max; n++) {
    const o = doc.objects.get(n) ?? null
    const container = o instanceof PdfStream && (isName(o.dict.get('Type'), 'XRef') || isName(o.dict.get('Type'), 'ObjStm'))
    b.add(container ? null : zeroGen(o))
  }
  const info = doc.trailer.get('Info')
  return b.serialize(new PdfRef(root.num), info instanceof PdfRef ? new PdfRef(info.num) : undefined)
}
