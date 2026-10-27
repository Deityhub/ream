/** a table cell's text as a number and the Excel format that shows it the same way, or null when it should stay text */
export function parseNumber(text: string): { value: number; numFmt?: string } | null {
  let s = text.trim().replace(/[−–]/g, '-')
  if (!s || s.length > 30) return null
  let negative = false
  const paren = /^\((.*)\)$/.exec(s)
  if (paren) { negative = true; s = paren[1].trim() }
  const sym = /^([$€£¥])\s*/.exec(s)?.[1] ?? /^-\s*([$€£¥])/.exec(s)?.[1]
  s = s.replace(/^-?\s*[$€£¥]\s*/, (m) => (m.startsWith('-') ? '-' : '')).trim()
  const percent = s.endsWith('%')
  if (percent) s = s.slice(0, -1).trim()
  const sign = /^[-+]/.exec(s)?.[0]
  if (sign) s = s.slice(1).trim()
  if (sign === '-') negative = !negative
  // 1,234.56  1234.56  .5  -- European 1.234,56 stays text: the separators are ambiguous
  if (!/^(\d{1,3}(,\d{3})+(\.\d+)?|\d+(\.\d+)?|\.\d+)$/.test(s)) return null
  const [int, frac = ''] = s.replace(/,/g, '').split('.')
  if (int.length > 1 && int.startsWith('0') && !frac) return null // codes like 007
  if (!s.includes(',') && !frac && int.length >= 11) return null // phone and account numbers
  if (int.length + frac.length > 15) return null // more digits than a double keeps
  let value = Number(`${int || '0'}.${frac || '0'}`)
  if (negative) value = -value
  if (percent) value /= 100
  const places = frac ? '.' + '0'.repeat(frac.length) : ''
  const grouped = s.includes(',')
  let numFmt: string | undefined
  if (percent) numFmt = `0${places}%`
  else if (sym) numFmt = `"${sym}"${grouped ? '#,##0' : '0'}${places}`
  else if (grouped) numFmt = `#,##0${places}`
  else if (frac) numFmt = `0${places}`
  return { value: percent ? Math.round(value * 1e10) / 1e10 : value, numFmt }
}
