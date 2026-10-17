// The bundled fonts read from node_modules, for tests and scripts.
import { readFile } from 'node:fs/promises'
import type { FontSource } from './book.ts'

export const nodeFonts: FontSource = async (family, subset, weight, italic) => {
  try {
    return new Uint8Array(await readFile(new URL(`../../../../node_modules/@fontsource/${family}/files/${family}-${subset}-${weight}-${italic ? 'italic' : 'normal'}.woff`, import.meta.url)))
  } catch {
    return null
  }
}
