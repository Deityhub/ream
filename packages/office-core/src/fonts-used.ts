// The font names an Office file asks for, so the app can look for them on the computer.
import { unzip } from '@ream/core'
import { readPptx } from './pptx-read.ts'
import { readXlsx } from './xlsx-read.ts'

/** font family names a .pptx or .xlsx uses, most used first; empty for anything else */
export async function usedFonts(bytes: Uint8Array): Promise<string[]> {
  const parts = await unzip(bytes).catch(() => null)
  const counts = new Map<string, number>()
  const add = (n: string | undefined, by = 1) => n && counts.set(n, (counts.get(n) ?? 0) + by)
  if (parts?.has('ppt/presentation.xml')) {
    for (const s of (await readPptx(bytes)).slides) {
      for (const sh of s.shapes) {
        const paras = sh.kind === 'text' ? sh.paragraphs : sh.kind === 'table' ? sh.cells.flat().flatMap((c) => c.paragraphs) : []
        for (const p of paras) for (const r of p.runs) add(r.font, r.text.length)
      }
    }
  } else if (parts?.has('xl/workbook.xml')) {
    for (const s of (await readXlsx(bytes)).sheets) for (const row of s.rows) for (const c of row ?? []) if (c?.style?.font) add(c.style.font)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([n]) => n)
}
