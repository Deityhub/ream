import { inflate, pngPredictor } from '@ream/core'
import { PdfName, PdfStream, isDict, type PdfObj } from './objects.ts'
import { PdfParseError } from './errors.ts'

export { inflate, deflate } from '@ream/core'

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
