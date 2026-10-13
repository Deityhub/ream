import { PdfName, PdfStream, isDict, type PdfObj } from './objects.ts'
import { PdfParseError } from './errors.ts'

// Platform seam: browser, Electron and Node 22 all ship these streams. A React Native build swaps in its own.
async function pipe(data: Uint8Array, t: DecompressionStream | CompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(t as ReadableWritablePair<Uint8Array, BufferSource>))
  return new Uint8Array(await out.arrayBuffer())
}

export const inflate = (data: Uint8Array) => pipe(data, new DecompressionStream('deflate'))
export const deflate = (data: Uint8Array) => pipe(data, new CompressionStream('deflate'))

/** undo PNG row filters (PDF /Predictor 10-15) */
export function pngPredictor(data: Uint8Array, columns: number, colors = 1, bpc = 8): Uint8Array {
  const bpp = Math.max(1, (colors * bpc + 7) >> 3)
  const row = (colors * bpc * columns + 7) >> 3
  const rows = Math.floor(data.length / (row + 1))
  const out = new Uint8Array(rows * row)
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (row + 1)]
    const src = r * (row + 1) + 1
    const dst = r * row
    for (let i = 0; i < row; i++) {
      const x = data[src + i]
      const a = i >= bpp ? out[dst + i - bpp] : 0
      const b = r > 0 ? out[dst - row + i] : 0
      const c = i >= bpp && r > 0 ? out[dst - row + i - bpp] : 0
      let v = x
      if (ft === 1) v = x + a
      else if (ft === 2) v = x + b
      else if (ft === 3) v = x + ((a + b) >> 1)
      else if (ft === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      out[dst + i] = v & 255
    }
  }
  return out
}

const asList = (o: PdfObj | undefined): PdfObj[] => (o == null ? [] : Array.isArray(o) ? o : [o])

/** Decode a stream's filters. Only Flate is supported; xref and object streams always use it. */
export async function decodeStream(s: PdfStream): Promise<Uint8Array> {
  const filters = asList(s.dict.get('Filter') ?? s.dict.get('F'))
  const parms = asList(s.dict.get('DecodeParms') ?? s.dict.get('DP'))
  let data = s.data
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i]
    if (!(f instanceof PdfName) || (f.value !== 'FlateDecode' && f.value !== 'Fl')) {
      throw new PdfParseError(`Unsupported stream filter ${f instanceof PdfName ? f.value : '?'}`)
    }
    try {
      data = await inflate(data)
    } catch {
      throw new PdfParseError('A compressed stream in this PDF is damaged')
    }
    const p = parms[i]
    if (isDict(p)) {
      const predictor = p.get('Predictor')
      if (typeof predictor === 'number' && predictor >= 10) {
        const num = (k: string, d: number) => (typeof p.get(k) === 'number' ? (p.get(k) as number) : d)
        data = pngPredictor(data, num('Columns', 1), num('Colors', 1), num('BitsPerComponent', 8))
      } else if (typeof predictor === 'number' && predictor > 1) {
        throw new PdfParseError('Unsupported stream predictor')
      }
    }
  }
  return data
}
