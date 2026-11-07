// The font names an Office file asks for, so the app can look for them on the computer.
import { unzip } from '@ream/core'
import { readDocx } from './docx-read.ts'
import { readPptx } from './pptx-read.ts'
import { readXlsx } from './xlsx-read.ts'

/** font family names a .docx, .pptx or .xlsx uses, most used first; empty for anything else */
export async function usedFonts(bytes: Uint8Array): Promise<string[]> {
  const parts = await unzip(bytes).catch(() => null)
  const counts = new Map<string, number>()
  const add = (n: string | undefined, by = 1) => n && counts.set(n, (counts.get(n) ?? 0) + by)
  const carried = new Set<string>()
  if (parts?.has('ppt/presentation.xml')) {
    for (const s of (await readPptx(bytes)).slides) {
      for (const sh of s.shapes) {
        const paras = sh.kind === 'text' ? sh.paragraphs : sh.kind === 'table' ? sh.cells.flat().flatMap((c) => c.paragraphs) : []
        for (const p of paras) for (const r of p.runs) add(r.font, r.text.length)
      }
    }
  } else if (parts?.has('word/document.xml')) {
    const doc = await readDocx(bytes)
    // a family the file carries needs nothing from the computer
    for (const f of doc.fonts ?? []) carried.add(f.name.toLowerCase())
    for (const sec of doc.sections) {
      for (const b of [...sec.blocks, ...(sec.header ?? []), ...(sec.footer ?? []), ...(sec.firstHeader ?? []), ...(sec.firstFooter ?? [])]) {
        const paras = b.kind === 'p' ? [b] : b.kind === 'table' ? b.rows.flat().flatMap((c) => c.paragraphs) : []
        for (const p of paras) for (const r of p.runs) add(r.font, r.text.length)
      }
    }
  } else if (parts?.has('xl/workbook.xml')) {
    for (const s of (await readXlsx(bytes)).sheets) for (const row of s.rows) for (const c of row ?? []) if (c?.style?.font) add(c.style.font)
  }
  return [...counts].filter(([n]) => !carried.has(n.toLowerCase())).sort((a, b) => b[1] - a[1]).map(([n]) => n)
}
