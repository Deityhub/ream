import { PdfKeyword, PdfName, PdfRef, PdfStream, PdfString, type PdfDict, type PdfObj } from './objects.ts'
import { PdfParseError } from './errors.ts'
import { ascii, indexOfBytes, latin1 } from './bytes.ts'

export const isWs = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32
export const isDelim = (c: number) =>
  c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37
const isDigit = (c: number) => c >= 48 && c <= 57
const hexVal = (c: number) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1)

const INT = /^[+-]?\d+$/
const UINT = /^\d+$/
const REAL = /^[+-]?(\d+\.?\d*|\.\d+)$/
const ENDSTREAM = ascii('endstream')

export class Parser {
  data: Uint8Array
  pos: number
  constructor(data: Uint8Array, pos = 0) {
    this.data = data
    this.pos = pos
  }

  skipWs() {
    const d = this.data
    while (this.pos < d.length) {
      const c = d[this.pos]
      if (isWs(c)) this.pos++
      else if (c === 37) while (this.pos < d.length && d[this.pos] !== 10 && d[this.pos] !== 13) this.pos++
      else break
    }
  }

  startsWith(s: string): boolean {
    for (let i = 0; i < s.length; i++) if (this.data[this.pos + i] !== s.charCodeAt(i)) return false
    return true
  }

  private word(): string {
    const d = this.data
    const start = this.pos
    while (this.pos < d.length && !isWs(d[this.pos]) && !isDelim(d[this.pos])) this.pos++
    return latin1(d.subarray(start, this.pos))
  }

  readValue(depth = 0): PdfObj | PdfKeyword {
    if (depth > 256) throw new PdfParseError('Object nesting is too deep')
    this.skipWs()
    const d = this.data
    if (this.pos >= d.length) throw new PdfParseError('Unexpected end of file')
    const c = d[this.pos]
    if (c === 47) return this.name()
    if (c === 40) return this.literal()
    if (c === 60) return d[this.pos + 1] === 60 ? this.dict(depth) : this.hex()
    if (c === 91) return this.array(depth)
    if (c === 41 || c === 93 || c === 62 || c === 123 || c === 125) {
      this.pos++
      return new PdfKeyword(String.fromCharCode(c))
    }
    const w = this.word()
    if (INT.test(w)) return UINT.test(w) ? this.maybeRef(parseInt(w, 10)) : parseInt(w, 10)
    if (REAL.test(w)) return parseFloat(w)
    if (w === 'true') return true
    if (w === 'false') return false
    if (w === 'null') return null
    return new PdfKeyword(w)
  }

  /** "12 0 R" after reading 12; otherwise rewind and return the plain number */
  private maybeRef(num: number): PdfObj {
    const d = this.data
    const save = this.pos
    this.skipWs()
    if (isDigit(d[this.pos])) {
      const w = this.word()
      if (UINT.test(w)) {
        this.skipWs()
        const after = d[this.pos + 1]
        if (d[this.pos] === 82 && (this.pos + 1 >= d.length || isWs(after) || isDelim(after))) {
          this.pos++
          return new PdfRef(num, parseInt(w, 10))
        }
      }
    }
    this.pos = save
    return num
  }

  private name(): PdfName {
    const d = this.data
    this.pos++
    const out: number[] = []
    while (this.pos < d.length) {
      const c = d[this.pos]
      if (isWs(c) || isDelim(c)) break
      const h1 = c === 35 ? hexVal(d[this.pos + 1]) : -1
      const h2 = c === 35 ? hexVal(d[this.pos + 2]) : -1
      if (h1 >= 0 && h2 >= 0) {
        out.push(h1 * 16 + h2)
        this.pos += 3
      } else {
        out.push(c)
        this.pos++
      }
    }
    return new PdfName(latin1(Uint8Array.from(out)))
  }

  private literal(): PdfString {
    const d = this.data
    this.pos++
    const out: number[] = []
    let depth = 1
    for (;;) {
      if (this.pos >= d.length) throw new PdfParseError('Unterminated string')
      const c = d[this.pos++]
      if (c === 92) {
        const e = d[this.pos++]
        if (e === 110) out.push(10)
        else if (e === 114) out.push(13)
        else if (e === 116) out.push(9)
        else if (e === 98) out.push(8)
        else if (e === 102) out.push(12)
        else if (e >= 48 && e <= 55) {
          let v = e - 48
          for (let i = 0; i < 2 && d[this.pos] >= 48 && d[this.pos] <= 55; i++) v = v * 8 + d[this.pos++] - 48
          out.push(v & 255)
        } else if (e === 13) {
          if (d[this.pos] === 10) this.pos++
        } else if (e !== 10) out.push(e)
      } else if (c === 40) {
        depth++
        out.push(c)
      } else if (c === 41) {
        if (--depth === 0) break
        out.push(c)
      } else out.push(c)
    }
    return new PdfString(Uint8Array.from(out), false)
  }

  private hex(): PdfString {
    const d = this.data
    this.pos++
    const digits: number[] = []
    for (;;) {
      if (this.pos >= d.length) throw new PdfParseError('Unterminated hex string')
      const c = d[this.pos++]
      if (c === 62) break
      const v = hexVal(c)
      if (v >= 0) digits.push(v)
    }
    if (digits.length % 2) digits.push(0)
    const out = new Uint8Array(digits.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = digits[2 * i] * 16 + digits[2 * i + 1]
    return new PdfString(out, true)
  }

  private array(depth: number): PdfObj[] {
    const d = this.data
    this.pos++
    const out: PdfObj[] = []
    for (;;) {
      this.skipWs()
      if (this.pos >= d.length) throw new PdfParseError('Unterminated array')
      if (d[this.pos] === 93) {
        this.pos++
        return out
      }
      const v = this.readValue(depth + 1)
      if (v instanceof PdfKeyword) throw new PdfParseError(`Unexpected "${v.value}" in array`)
      out.push(v)
    }
  }

  private dict(depth: number): PdfDict {
    const d = this.data
    this.pos += 2
    const out: PdfDict = new Map()
    for (;;) {
      this.skipWs()
      if (this.pos >= d.length) throw new PdfParseError('Unterminated dictionary')
      if (d[this.pos] === 62 && d[this.pos + 1] === 62) {
        this.pos += 2
        return out
      }
      const key = this.readValue(depth + 1)
      if (!(key instanceof PdfName)) throw new PdfParseError('Dictionary key is not a name')
      this.skipWs()
      if (d[this.pos] === 62 && d[this.pos + 1] === 62) {
        out.set(key.value, null)
        continue
      }
      const v = this.readValue(depth + 1)
      if (v instanceof PdfKeyword) throw new PdfParseError(`Unexpected "${v.value}" in dictionary`)
      out.set(key.value, v)
    }
  }
}

export type Indirect = { num: number; gen: number; obj: PdfObj; end: number }

/**
 * Parse "n g obj ... endobj" at offset. `lengthOf` turns a stream's /Length value (number or ref) into a
 * number, or NaN when unknown; a wrong or unknown length falls back to scanning for "endstream".
 */
export function parseIndirectAt(data: Uint8Array, offset: number, lengthOf: (o: PdfObj) => number): Indirect {
  const p = new Parser(data, offset)
  const num = p.readValue()
  const gen = p.readValue()
  const kw = p.readValue()
  if (typeof num !== 'number' || typeof gen !== 'number' || !(kw instanceof PdfKeyword) || kw.value !== 'obj') {
    throw new PdfParseError(`Expected an object at byte ${offset}`)
  }
  let obj: PdfObj
  const v = p.readValue()
  if (v instanceof PdfKeyword) {
    if (v.value !== 'endobj') throw new PdfParseError(`Unexpected "${v.value}" in object ${num}`)
    return { num, gen, obj: null, end: p.pos }
  }
  obj = v
  if (v instanceof Map) {
    p.skipWs()
    if (p.startsWith('stream')) {
      p.pos += 6
      if (data[p.pos] === 13) {
        p.pos++
        if (data[p.pos] === 10) p.pos++
      } else if (data[p.pos] === 10) p.pos++
      const start = p.pos
      const len = lengthOf(v.get('Length') ?? null)
      let end = -1
      if (Number.isInteger(len) && len >= 0 && start + len <= data.length) {
        const q = new Parser(data, start + len)
        q.skipWs()
        if (q.startsWith('endstream')) {
          end = start + len
          p.pos = q.pos + 9
        }
      }
      if (end < 0) {
        const idx = indexOfBytes(data, ENDSTREAM, start)
        if (idx < 0) throw new PdfParseError(`Stream in object ${num} never ends`)
        end = idx
        if (end > start && data[end - 1] === 10) end--
        if (end > start && data[end - 1] === 13) end--
        p.pos = idx + 9
      }
      obj = new PdfStream(v, data.subarray(start, end))
    }
  }
  p.skipWs()
  if (p.startsWith('endobj')) p.pos += 6
  return { num, gen, obj, end: p.pos }
}
