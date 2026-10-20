import { PdfName, PdfStream, decodeStream, readTables, type PdfDict, type PdfDocument } from '@ream/pdf-core'
import { readCff, type CffProgram } from './cff.ts'
import { readTrueType, type TrueTypeProgram } from './truetype.ts'
import { readType1 } from './type1.ts'
import type { FontProgram } from './path.ts'

export type { GlyphPath, FontProgram } from './path.ts'
export { tracePath } from './path.ts'
export { readTrueType, type TrueTypeProgram } from './truetype.ts'
export { readCff, type CffProgram } from './cff.ts'
export { readType1 } from './type1.ts'

export type Program = TrueTypeProgram | CffProgram | FontProgram
export type EmbeddedFile = { kind: 'type1' | 'sfnt' | 'cff'; bytes: Uint8Array; length1?: number }

/** the font program a font descriptor embeds, decoded; null when there is none or it can't be read */
export async function embeddedFile(doc: PdfDocument, desc: PdfDict | null): Promise<EmbeddedFile | null> {
  if (!desc) return null
  for (const key of ['FontFile', 'FontFile2', 'FontFile3'] as const) {
    const s = doc.resolve(desc.get(key))
    if (!(s instanceof PdfStream)) continue
    try {
      const bytes = await decodeStream(s)
      const sub = doc.resolve(s.dict.get('Subtype'))
      const length1 = doc.resolve(s.dict.get('Length1'))
      if (key === 'FontFile') return { kind: 'type1', bytes, length1: typeof length1 === 'number' ? length1 : undefined }
      if (key === 'FontFile3' && !(sub instanceof PdfName && sub.value === 'OpenType')) return { kind: 'cff', bytes }
      return { kind: 'sfnt', bytes }
    } catch {
      return null
    }
  }
  return null
}

/** read a font program; a damaged or unsupported one is null and the text falls back to a similar system font */
export function readProgram(file: EmbeddedFile): Program | null {
  try {
    if (file.kind === 'type1') return readType1(file.bytes, file.length1)
    const b = file.bytes
    const sfnt = (b[0] === 0x4f && b[1] === 0x54 && b[2] === 0x54 && b[3] === 0x4f) || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || (b[0] === 0x74 && b[1] === 0x72)
    // producers label OpenType files loosely: what the bytes are decides
    if (file.kind === 'cff' && !sfnt) return readCff(b)
    const cff = readTables(b).get('CFF ')
    return cff ? readCff(cff) : readTrueType(b)
  } catch {
    return null
  }
}
