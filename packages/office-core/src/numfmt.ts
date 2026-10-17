// Excel number formats: a value and a format code in, the text Excel would show out. US English conventions.
// ponytail: conditions ([>100]), fractions (# ?/?), elapsed time ([h]) and scientific with grouping are not handled; they fall back to the plain number.

/** the formats Excel knows by number (ids not in the table are locale specific and read as General) */
export const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 48: '##0.0E+0', 49: '@',
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** how a number shows with no format: up to 10 significant digits, no trailing zeros */
export function general(v: number): string {
  if (!Number.isFinite(v)) return '#NUM!'
  const s = String(+v.toPrecision(10))
  return s.includes('e') ? s.replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2') : s
}

/** split a format into its `;` sections and drop colour and locale tags, keeping a currency symbol from [$€-407] */
const sections = (code: string): string[] => split(code).map((s) => s.replace(/\[\$([^\]-]*)(-[^\]]*)?\]/g, '"$1"').replace(/\[(red|black|blue|green|white|cyan|magenta|yellow|color\s*\d+)\]/gi, ''))

function split(code: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    if (ch === '"') quoted = !quoted
    if (ch === '\\' && !quoted) { cur += ch + (code[++i] ?? ''); continue }
    if (ch === ';' && !quoted) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

/** which section of a format a value is shown with */
const sectionOf = (value: string | number, count: number) =>
  typeof value === 'string' ? (count > 3 ? 3 : count - 1) : count === 1 ? 0 : value < 0 ? 1 : value === 0 && count >= 3 ? 2 : 0

const NAMED: Record<string, string> = { black: '000000', blue: '0000FF', cyan: '00FFFF', green: '00FF00', magenta: 'FF00FF', red: 'FF0000', white: 'FFFFFF', yellow: 'FFFF00' }

/** the colour a format gives a value, like the red of "#,##0;[Red]-#,##0" for a negative number (RRGGBB), or undefined */
export function formatColor(value: string | number | boolean | null, code: string | undefined): string | undefined {
  if (value === null || typeof value === 'boolean' || !code || /^general$/i.test(code)) return undefined
  const secs = split(code)
  // ponytail: [ColorN] (the 56-colour palette) is left at the cell's own colour; add the palette if files use it
  return NAMED[/\[(black|blue|cyan|green|magenta|red|white|yellow)\]/i.exec((secs[sectionOf(value, secs.length)] ?? '').replace(/"[^"]*"/g, ''))?.[1].toLowerCase() ?? '']
}

type Token = { kind: 'lit'; text: string } | { kind: 'sym'; text: string }

/** literals ("..", \x, _x spaces) as `lit`, everything else as one-char `sym` */
function tokens(sec: string): Token[] {
  const out: Token[] = []
  for (let i = 0; i < sec.length; i++) {
    const ch = sec[i]
    if (ch === '"') {
      const e = sec.indexOf('"', i + 1)
      out.push({ kind: 'lit', text: sec.slice(i + 1, e < 0 ? undefined : e) })
      i = e < 0 ? sec.length : e
    } else if (ch === '\\') out.push({ kind: 'lit', text: sec[++i] ?? '' })
    else if (ch === '_') { i++; out.push({ kind: 'lit', text: ' ' }) }
    else if (ch === '*') i++
    else out.push({ kind: 'sym', text: ch })
  }
  return out
}

const isDateFormat = (toks: Token[]) => {
  const syms = toks.filter((t) => t.kind === 'sym').map((t) => t.text.toLowerCase()).join('')
  return /[ymdhs]/.test(syms.replace(/e[+-]|general/g, '')) && !/[0#?]/.test(syms)
}

// ---------- dates ----------

function serialToParts(serial: number, date1904: boolean) {
  let days = Math.floor(serial)
  if (!date1904 && days > 60) days -= 1 // Excel counts a 29 February 1900 that never existed
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31)
  const secs = Math.round((serial - Math.floor(serial)) * 86400)
  const d = new Date(base + days * 86400000)
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), h: Math.floor(secs / 3600) % 24, mi: Math.floor(secs / 60) % 60, s: secs % 60 }
}

function formatDate(v: number, toks: Token[], date1904: boolean): string {
  const p = serialToParts(v, date1904)
  const ampm = /am\/pm|a\/p/i.test(toks.map((t) => t.text).join(''))
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const syms = toks.map((t) => (t.kind === 'lit' ? '\u0000' + t.text + '\u0000' : t.text)).join('')
  const parts = syms.split('\u0000')
  let lastWasHour = false
  let out = ''
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) { out += part; return }
    const re = /yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm|a\/p|\.0+|./gi
    let m: RegExpExecArray | null
    while ((m = re.exec(part))) {
      const t = m[0]
      const k = t.toLowerCase()
      const nextIsSeconds = /^:?s/i.test(part.slice(m.index + t.length)) // "mm" is minutes after an hour or before seconds, months otherwise
      if (k === 'yyyy') out += pad(p.y, 4)
      else if (k === 'yy') out += pad(p.y % 100)
      else if (k === 'mmmmm') out += MONTHS[p.mo][0]
      else if (k === 'mmmm') out += MONTHS[p.mo]
      else if (k === 'mmm') out += MONTHS[p.mo].slice(0, 3)
      else if (k === 'mm' || k === 'm') {
        const minute = lastWasHour || nextIsSeconds
        const n = minute ? p.mi : p.mo + 1
        out += k === 'mm' ? pad(n) : String(n)
        lastWasHour = false
      } else if (k === 'dddd') out += DAYS[p.dow]
      else if (k === 'ddd') out += DAYS[p.dow].slice(0, 3)
      else if (k === 'dd') out += pad(p.d)
      else if (k === 'd') out += String(p.d)
      else if (k === 'hh' || k === 'h') {
        const h = ampm ? p.h % 12 || 12 : p.h
        out += k === 'hh' ? pad(h) : String(h)
        lastWasHour = true
        continue
      } else if (k === 'ss') out += pad(p.s)
      else if (k === 's') out += String(p.s)
      else if (k === 'am/pm') out += p.h < 12 ? 'AM' : 'PM'
      else if (k === 'a/p') out += p.h < 12 ? 'A' : 'P'
      else if (k.startsWith('.0')) out += ''
      else out += t
      if (k !== ':') lastWasHour = false
    }
  })
  return out
}

// ---------- numbers ----------

function formatNumber(v: number, toks: Token[], negative: boolean): string {
  const percent = toks.some((t) => t.kind === 'sym' && t.text === '%')
  let x = Math.abs(v) * (percent ? 100 : 1)
  // trailing commas right after the digit placeholders divide by a thousand each
  const lastDigit = toks.map((t) => t.kind === 'sym' && /[0#?]/.test(t.text)).lastIndexOf(true)
  let scale = 0
  for (let i = lastDigit + 1; i < toks.length && toks[i].kind === 'sym' && toks[i].text === ','; i++) scale++
  x /= 1000 ** scale
  const firstDigit = toks.findIndex((t) => t.kind === 'sym' && /[0#?]/.test(t.text))
  const dot = toks.findIndex((t, i) => i >= firstDigit && t.kind === 'sym' && t.text === '.')
  const isDigit = (t: Token) => t.kind === 'sym' && /[0#?]/.test(t.text)
  const intToks = firstDigit < 0 ? [] : toks.slice(firstDigit, dot < 0 ? lastDigit + 1 : dot).filter(isDigit)
  const fracToks = dot < 0 ? [] : toks.slice(dot + 1, lastDigit + 1).filter(isDigit)
  const grouped = firstDigit >= 0 && toks.slice(firstDigit, lastDigit + 1).some((t) => t.kind === 'sym' && t.text === ',')
  const fixed = x.toFixed(Math.min(20, fracToks.length))
  let [ip, fp = ''] = fixed.split('.')
  const minInt = intToks.filter((t) => t.text === '0').length
  if (ip === '0' && minInt === 0) ip = ''
  ip = ip.padStart(minInt, '0')
  if (grouped) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  // '#' and '?' places at the end of the fraction hold no trailing zeros
  let keep = fp.length
  while (keep > 0 && fracToks[keep - 1].text !== '0' && fp[keep - 1] === '0') keep--
  fp = fp.slice(0, keep)
  const number = fp ? `${ip}.${fp}` : ip
  let out = ''
  let placed = false
  toks.forEach((t, i) => {
    if (i >= firstDigit && i <= lastDigit && firstDigit >= 0) {
      if (!placed) { out += number; placed = true }
    } else if (t.kind === 'lit') out += t.text
    else if (t.text === ',' && i > lastDigit) out += ''
    else if (t.text === '@') out += ''
    else out += t.text
  })
  if (firstDigit < 0) out = out || general(x)
  return (negative ? '-' : '') + out
}

/**
 * The text Excel shows for a value under a format code. `code` undefined or "General" shows the value as is.
 * Strings pass through unless the format has an @ place for them.
 */
export function formatValue(value: string | number | boolean | null, code: string | undefined, date1904 = false): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  const secs = !code || /^general$/i.test(code) ? null : sections(code)
  if (typeof value === 'string') {
    const text = secs?.[sectionOf(value, secs.length)]
    return text?.includes('@') ? tokens(text).map((t) => (t.kind === 'lit' ? t.text : t.text === '@' ? value : t.text)).join('') : value
  }
  if (!secs) return general(value)
  const neg = value < 0
  const idx = sectionOf(value, secs.length)
  const toks = tokens(secs[idx])
  if (!toks.length) return ''
  if (isDateFormat(toks)) return value < 0 ? '#####' : formatDate(value, toks, date1904)
  if (toks.some((t) => t.kind === 'sym' && t.text === '@') && !toks.some((t) => t.kind === 'sym' && /[0#?]/.test(t.text))) return general(value)
  if (toks.some((t) => t.kind === 'sym' && t.text === '/') && toks.some((t) => t.kind === 'sym' && t.text === '?')) return general(value) // fractions
  return formatNumber(value, toks, neg && idx === 0)
}
