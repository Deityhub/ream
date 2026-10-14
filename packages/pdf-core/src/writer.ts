import { PdfName, PdfRef, PdfStream, PdfString, isName, name, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'
import { ascii, concat } from './bytes.ts'
import { deflate } from './flate.ts'

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

  /** `extra` are more trailer entries, written as they are (an /Encrypt reference, /ID) */
  serialize(root: PdfRef, info?: PdfRef, extra: [string, PdfObj][] = []): Uint8Array {
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
    for (const [k, v] of extra) {
      s.push(` ${fmtName(k)} `)
      emit(s, v)
    }
    s.push(` >>\nstartxref\n${xref}\n%%EOF\n`)
    return concat(s.chunks)
  }
}

const OBJECTS_PER_STREAM = 100

/**
 * Write a PDF 1.5 file: plain objects packed together into compressed object streams, and a compressed cross-reference
 * stream instead of the classic table. Much smaller for files with many small objects; needs a reader that knows PDF 1.5.
 */
export async function serializeCompact(b: PdfBuilder, root: PdfRef, info?: PdfRef, id?: PdfObj): Promise<Uint8Array> {
  const total = b.objects.length
  const packed: number[] = []
  const loose: number[] = []
  b.objects.forEach((o, i) => (o instanceof PdfStream ? loose : packed).push(i + 1))
  const streams = Math.ceil(packed.length / OBJECTS_PER_STREAM)
  const size = total + streams + 2 // objects, object streams, the xref stream, and object 0
  // where each object lives: [type, field 2, field 3] of its cross-reference entry
  const entries: [number, number, number][] = Array.from({ length: size }, () => [0, 0, 0])
  entries[0] = [0, 0, 65535]

  const s = new Sink()
  s.push('%PDF-1.5\n')
  s.push(Uint8Array.of(37, 0xe2, 0xe3, 0xcf, 0xd3, 10))
  const writeObject = (num: number, o: PdfObj) => {
    entries[num] = [1, s.length, 0]
    s.push(`${num} 0 obj\n`)
    emit(s, o)
    s.push('\nendobj\n')
  }
  for (const num of loose) writeObject(num, b.objects[num - 1]!)
  for (let k = 0; k < streams; k++) {
    const nums = packed.slice(k * OBJECTS_PER_STREAM, (k + 1) * OBJECTS_PER_STREAM)
    const bodies = nums.map((num) => {
      const t = new Sink()
      emit(t, b.objects[num - 1] ?? null)
      return concat(t.chunks)
    })
    let at = 0
    const header = nums.map((num, i) => {
      const line = `${num} ${at}`
      at += bodies[i].length + 1
      return line
    }).join(' ') + '\n'
    const headBytes = ascii(header)
    const data = concat([headBytes, ...bodies.flatMap((x) => [x, Uint8Array.of(10)])])
    const stmNum = total + 1 + k
    nums.forEach((num, i) => (entries[num] = [2, stmNum, i]))
    const dict = new Map<string, PdfObj>([['Type', name('ObjStm')], ['N', nums.length], ['First', headBytes.length], ['Filter', name('FlateDecode')]])
    writeObject(stmNum, new PdfStream(dict, await deflate(data)))
  }
  const xrefNum = total + streams + 1
  entries[xrefNum] = [1, s.length, 0]
  const rows = new Uint8Array(size * 7)
  entries.forEach(([t, a, c], i) => rows.set([t, (a >>> 24) & 255, (a >>> 16) & 255, (a >>> 8) & 255, a & 255, (c >> 8) & 255, c & 255], i * 7))
  const dict = new Map<string, PdfObj>([['Type', name('XRef')], ['Size', size], ['W', [1, 4, 2]], ['Root', new PdfRef(root.num)], ['Filter', name('FlateDecode')]])
  if (info) dict.set('Info', new PdfRef(info.num))
  if (id) dict.set('ID', id)
  s.push(`${xrefNum} 0 obj\n`)
  emit(s, new PdfStream(dict, await deflate(rows)))
  s.push(`\nendobj\nstartxref\n${entries[xrefNum][1]}\n%%EOF\n`)
  return concat(s.chunks)
}

/** every ref points at generation 0 in a file we write */
export const zeroGen = (o: PdfObj): PdfObj =>
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
