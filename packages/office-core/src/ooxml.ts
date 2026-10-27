// Pieces every Office format shares: part names, relationships, colours, the theme.
import { child, dig, kids, num, type XmlNode } from './xml.ts'

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
export function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** "B3" -> { col: 1, row: 2 } (0-based); null when it isn't a cell reference */
export function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref)
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64
  return { col: col - 1, row: Number(m[2]) - 1 }
}

/** the part a relationship target names: relative to the folder of the part that holds the relationship, or from the root */
export function resolvePart(from: string, target: string): string {
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

/** the relationships file of a part: "xl/workbook.xml" -> "xl/_rels/workbook.xml.rels" */
export const relsOf = (part: string) => part.replace(/([^/]+)$/, '_rels/$1.rels')

/** relationship id -> { target part, type }, from a parsed .rels file */
export function readRels(rels: XmlNode | undefined, from: string): Map<string, { part: string; type: string; external: boolean }> {
  const out = new Map<string, { part: string; type: string; external: boolean }>()
  for (const r of kids(rels, 'Relationship')) {
    if (r.attrs.Id && r.attrs.Target) out.set(r.attrs.Id, { part: resolvePart(from, r.attrs.Target), type: r.attrs.Type ?? '', external: r.attrs.TargetMode === 'External' })
  }
  return out
}

// ---------- colours ----------

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')

/** lighten (tint > 0) or darken (tint < 0) a RRGGBB colour. Excel works in HSL; scaling RGB is close enough for fills and text. */
export function tint(rgb: string, t: number): string {
  if (!t) return rgb
  const c = [0, 2, 4].map((i) => parseInt(rgb.slice(i, i + 2), 16))
  return c.map((v) => hex2(t > 0 ? v + (255 - v) * t : v * (1 + t))).join('')
}

export type Theme = {
  colors: Record<string, string>
  major: string
  minor: string
  /** widths of the theme's line styles, EMU */
  lineWidths: number[]
  /** the format scheme's fills, lines and background fills (shapes point into these by number) */
  fillStyles: XmlNode[]
  lineStyles: XmlNode[]
  bgFillStyles: XmlNode[]
}

export const DEFAULT_THEME: Theme = {
  colors: { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72' },
  major: 'Calibri Light',
  minor: 'Calibri',
  lineWidths: [6350, 12700, 19050],
  fillStyles: [],
  lineStyles: [],
  bgFillStyles: [],
}

/** colours and fonts of a theme part; anything missing keeps the Office default */
export function readTheme(root: XmlNode | undefined): Theme {
  const t: Theme = { colors: { ...DEFAULT_THEME.colors }, major: DEFAULT_THEME.major, minor: DEFAULT_THEME.minor, lineWidths: [...DEFAULT_THEME.lineWidths], fillStyles: [], lineStyles: [], bgFillStyles: [] }
  const scheme = dig(root, 'themeElements', 'clrScheme')
  for (const c of scheme?.children ?? []) {
    const v = c.children[0]
    const rgb = v?.attrs.val && v.name === 'srgbClr' ? v.attrs.val : v?.attrs.lastClr
    if (rgb && /^[0-9a-f]{6}$/i.test(rgb)) t.colors[c.name] = rgb.toUpperCase()
  }
  const fonts = dig(root, 'themeElements', 'fontScheme')
  t.major = dig(fonts, 'majorFont', 'latin')?.attrs.typeface || t.major
  t.minor = dig(fonts, 'minorFont', 'latin')?.attrs.typeface || t.minor
  const fmt = dig(root, 'themeElements', 'fmtScheme')
  t.fillStyles = child(fmt, 'fillStyleLst')?.children ?? []
  t.lineStyles = child(fmt, 'lnStyleLst')?.children ?? []
  t.bgFillStyles = child(fmt, 'bgFillStyleLst')?.children ?? []
  const lines = kids(dig(root, 'themeElements', 'fmtScheme', 'lnStyleLst'), 'ln')
  if (lines.length) t.lineWidths = lines.map((l, i) => num(l, 'w', DEFAULT_THEME.lineWidths[i] ?? 12700))
  return t
}

/** spreadsheet theme index (0 light 1, 1 dark 1, 2 light 2, 3 dark 2, 4..9 accents) */
export const SHEET_THEME = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']

// ponytail: the 16 basic legacy palette entries; the other 48 indexed colours are read as "no colour". Add the full table if a file needs it.
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF']

/** an Excel colour element (<color rgb=.. theme=.. indexed=.. tint=..>) as RRGGBB, or undefined for "automatic" */
export function sheetColor(n: XmlNode | undefined, theme: Theme): string | undefined {
  if (!n) return undefined
  let rgb: string | undefined
  if (n.attrs.rgb && /^[0-9a-f]{6,8}$/i.test(n.attrs.rgb)) rgb = n.attrs.rgb.slice(-6).toUpperCase()
  else if (n.attrs.theme !== undefined) rgb = theme.colors[SHEET_THEME[Number(n.attrs.theme)]]
  else if (n.attrs.indexed !== undefined) rgb = INDEXED[Number(n.attrs.indexed)]
  return rgb ? tint(rgb, num(n, 'tint')) : undefined
}
