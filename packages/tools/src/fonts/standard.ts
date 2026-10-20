// The bundled look-alikes the renderer draws Helvetica, Times and Courier with when a PDF doesn't embed them: Arimo,
// Tinos and Cousine have the same letter widths, so text looks the same on every computer.
import { woffToSfnt } from '@ream/pdf-core'
import type { FontSource } from './book.ts'

const FAMILY = { sans: 'arimo', serif: 'tinos', mono: 'cousine' } as const

/** `Platform.standardFont` for the renderer: the latin and latin-ext parts of the face, unpacked from WOFF, loaded once */
export function standardFonts(source: FontSource): (kind: keyof typeof FAMILY, bold: boolean, italic: boolean) => Promise<Uint8Array[]> {
  const loaded = new Map<string, Promise<Uint8Array[]>>()
  return (kind, bold, italic) => {
    const key = `${kind}${bold}${italic}`
    let parts = loaded.get(key)
    if (!parts) {
      parts = Promise.all(['latin', 'latin-ext'].map(async (subset) => {
        const woff = await source(FAMILY[kind], subset, bold ? 700 : 400, italic)
        return woff ? woffToSfnt(woff) : null
      })).then((p) => p.filter((x): x is Uint8Array => !!x))
      loaded.set(key, parts)
    }
    return parts
  }
}
