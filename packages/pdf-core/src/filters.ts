import { inflate, pngPredictor } from '@ream/core'
import { PdfName, PdfStream, isDict, type PdfDict, type PdfObj } from './objects.ts'
import { PdfParseError } from './errors.ts'

const asList = (o: PdfObj | undefined): PdfObj[] => (o == null ? [] : Array.isArray(o) ? o : [o])

/** filters that produce pixels rather than bytes; decoding stops in front of these and leaves them to an image decoder */
const IMAGE_FILTERS = new Set(['DCTDecode', 'DCT', 'JPXDecode', 'CCITTFaxDecode', 'CCF', 'JBIG2Decode'])

// ---------- the simple byte filters ----------

export function asciiHexDecode(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let hi = -1
  for (const c of data) {
    if (c === 62) break // '>'
    const v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1
    if (v < 0) continue
    if (hi < 0) hi = v
    else {
      out.push(hi * 16 + v)
      hi = -1
    }
  }
  if (hi >= 0) out.push(hi * 16)
  return Uint8Array.from(out)
}

export function ascii85Decode(data: Uint8Array): Uint8Array {
  const out: number[] = []
  const group: number[] = []
  const flush = (n: number) => {
    // a partial group of n characters stands for n-1 bytes: pad with 'u' (84) and keep the leading bytes
    for (let i = group.length; i < 5; i++) group.push(84)
    let v = 0
    for (const d of group) v = v * 85 + d
    const bytes = [(v / 2 ** 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
    out.push(...bytes.slice(0, n - 1))
    group.length = 0
  }
  for (let i = 0; i < data.length; i++) {
    const c = data[i]
    if (c === 126) break // '~>' ends the data
    if (c <= 32) continue
    if (c === 122 && group.length === 0) out.push(0, 0, 0, 0) // 'z' is four zero bytes
    else if (c >= 33 && c <= 117) {
      group.push(c - 33)
      if (group.length === 5) flush(5)
    }
  }
  if (group.length > 1) flush(group.length)
  return Uint8Array.from(out)
}

export function runLengthDecode(data: Uint8Array): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < data.length; ) {
    const n = data[i++]
    if (n === 128) break
    if (n < 128) for (let k = 0; k <= n && i < data.length; k++) out.push(data[i++])
    else {
      const b = data[i++]
      for (let k = 0; k < 257 - n; k++) out.push(b)
    }
  }
  return Uint8Array.from(out)
}

/** LZW as PDF uses it: MSB-first codes of 9 to 12 bits, 256 = clear, 257 = end of data */
export function lzwDecode(data: Uint8Array, earlyChange = 1): Uint8Array {
  const dict: Uint8Array[] = Array.from({ length: 256 }, (_, i) => Uint8Array.of(i))
  dict.push(new Uint8Array(0), new Uint8Array(0)) // 256, 257
  const chunks: Uint8Array[] = []
  let bits = 9
  let prev: Uint8Array | null = null
  let buf = 0
  let have = 0
  let pos = 0
  for (;;) {
    while (have < bits && pos < data.length) {
      buf = ((buf << 8) | data[pos++]) >>> 0
      have += 8
    }
    if (have < bits) break
    const code = (buf >>> (have - bits)) & ((1 << bits) - 1)
    have -= bits
    buf &= (1 << have) - 1
    if (code === 256) {
      dict.length = 258
      bits = 9
      prev = null
      continue
    }
    if (code === 257) break
    let entry: Uint8Array
    if (code < dict.length) entry = dict[code]
    else if (code === dict.length && prev) entry = Uint8Array.from([...prev, prev[0]])
    else break // corrupt: stop with what we have
    chunks.push(entry)
    if (prev && dict.length < 4096) dict.push(Uint8Array.from([...prev, entry[0]]))
    prev = entry
    const next = dict.length + earlyChange
    bits = next >= 2048 ? 12 : next >= 1024 ? 11 : next >= 512 ? 10 : 9
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  chunks.reduce((at, c) => (out.set(c, at), at + c.length), 0)
  return out
}

/** TIFF predictor 2 on 8-bit samples: each sample is stored as the difference from the one to its left */
export function tiffPredictor(data: Uint8Array, columns: number, colors: number): Uint8Array {
  const row = columns * colors
  const out = data.slice()
  for (let r = 0; r + row <= out.length; r += row) {
    for (let i = colors; i < row; i++) out[r + i] = (out[r + i] + out[r + i - colors]) & 255
  }
  return out
}

function applyPredictor(data: Uint8Array, parms: PdfObj | undefined): Uint8Array {
  if (!isDict(parms)) return data
  const num = (k: string, d: number) => (typeof parms.get(k) === 'number' ? (parms.get(k) as number) : d)
  const predictor = num('Predictor', 1)
  if (predictor >= 10) return pngPredictor(data, num('Columns', 1), num('Colors', 1), num('BitsPerComponent', 8))
  if (predictor === 2) {
    if (num('BitsPerComponent', 8) !== 8) throw new PdfParseError('Unsupported stream predictor')
    return tiffPredictor(data, num('Columns', 1), num('Colors', 1))
  }
  return data
}

// ---------- the filter chain ----------

export type Decoded = {
  data: Uint8Array
  /** set when decoding stopped in front of an image filter (JPEG, JPEG 2000, CCITT, JBIG2) */
  rest: { filter: string; parms: PdfDict | null } | null
}

/** Run a stream's filters in order. Stops, returning what is left to do, at the first image filter. */
export async function decodeUntilImage(s: PdfStream): Promise<Decoded> {
  const filters = asList(s.dict.get('Filter') ?? s.dict.get('F'))
  const parms = asList(s.dict.get('DecodeParms') ?? s.dict.get('DP'))
  let data = s.data
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i]
    if (!(f instanceof PdfName)) throw new PdfParseError('Bad stream filter')
    const p = parms[i]
    if (IMAGE_FILTERS.has(f.value)) return { data, rest: { filter: f.value, parms: isDict(p) ? p : null } }
    switch (f.value) {
      case 'FlateDecode':
      case 'Fl':
        try {
          data = await inflate(data)
        } catch {
          throw new PdfParseError('A compressed stream in this PDF is damaged')
        }
        data = applyPredictor(data, p)
        break
      case 'LZWDecode':
      case 'LZW':
        data = applyPredictor(lzwDecode(data, isDict(p) && p.get('EarlyChange') === 0 ? 0 : 1), p)
        break
      case 'ASCII85Decode':
      case 'A85':
        data = ascii85Decode(data)
        break
      case 'ASCIIHexDecode':
      case 'AHx':
        data = asciiHexDecode(data)
        break
      case 'RunLengthDecode':
      case 'RL':
        data = runLengthDecode(data)
        break
      case 'Crypt':
        break // decryption already happened when the file was opened
      default:
        throw new PdfParseError(`Unsupported stream filter ${f.value}`)
    }
  }
  return { data, rest: null }
}

/** fully decoded bytes of a stream whose filters are all byte filters (not images) */
export async function decodeStream(s: PdfStream): Promise<Uint8Array> {
  const d = await decodeUntilImage(s)
  if (d.rest) throw new PdfParseError(`Unsupported stream filter ${d.rest.filter}`)
  return d.data
}
