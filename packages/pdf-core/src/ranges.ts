import { PdfRangeError } from './errors.ts'

/**
 * "1-3,5,8-" -> [[0,1,2],[4],[7,...,count-1]]. One group per comma item (split makes one file per group,
 * extract concatenates them). Pages are 1-based in the text and 0-based in the result.
 */
export function parseRanges(spec: string, count: number): number[][] {
  const items = spec.split(',').map((s) => s.trim()).filter(Boolean)
  if (!items.length) throw new PdfRangeError('Enter at least one page or range, like 1-3,5')
  return items.map((item) => {
    const m = /^(\d+)(?:\s*-\s*(\d*))?$/.exec(item)
    if (!m) throw new PdfRangeError(`"${item}" isn't a page or range. Use numbers like 1-3,5`)
    const from = parseInt(m[1], 10)
    const to = m[2] === undefined ? from : m[2] === '' ? count : parseInt(m[2], 10)
    for (const n of [from, to]) {
      if (n < 1 || n > count) throw new PdfRangeError(`Page ${n} doesn't exist; this PDF has ${count} ${count === 1 ? 'page' : 'pages'}`)
    }
    if (to < from) throw new PdfRangeError(`The range ${item} runs backwards`)
    return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i)
  })
}

/** every N pages: chunks(5, 2) -> [[0,1],[2,3],[4]] */
export function chunks(count: number, n: number): number[][] {
  if (!Number.isInteger(n) || n < 1) throw new PdfRangeError('Pages per file must be a whole number of 1 or more')
  const out: number[][] = []
  for (let i = 0; i < count; i += n) out.push(Array.from({ length: Math.min(n, count - i) }, (_, j) => i + j))
  return out
}
