// DrawingML colours: srgbClr, schemeClr (through the colour map and the theme), sysClr, prstClr and the usual modifiers.
import { num, type XmlNode } from './xml.ts'
import type { Theme } from './ooxml.ts'

export type ColorContext = {
  theme: Theme
  /** the master's colour map: bg1 -> lt1, tx1 -> dk1 ... */
  clrMap: Record<string, string>
  /** what "phClr" (the colour a style reference supplies) stands for, when known */
  placeholder?: string
}

export type Resolved = { hex: string; alpha: number }

const PRESET: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', silver: 'C0C0C0', orange: 'FFA500', purple: '800080', cyan: '00FFFF', magenta: 'FF00FF', lime: '00FF00', navy: '000080', maroon: '800000', teal: '008080', olive: '808000',
  ltGray: 'D3D3D3', dkGray: 'A9A9A9', dkBlue: '00008B', dkRed: '8B0000', dkGreen: '006400', ltBlue: 'ADD8E6', medGray: '808080',
}
const SYSTEM: Record<string, string> = { windowText: '000000', window: 'FFFFFF', menuText: '000000', btnFace: 'F0F0F0', btnText: '000000' }

const parse = (hex: string): [number, number, number] => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const toHex = (c: number[]) => c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()

function rgbToHsl([r, g, b]: number[]): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}
function hslToRgb([h, s, l]: number[]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}

/** the colour a fill-like element holds (<a:solidFill>, <a:fgColor>, a font colour...): its first child names the colour */
export function resolveColor(holder: XmlNode | undefined, ctx: ColorContext): Resolved | undefined {
  const c = holder && ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'hslClr', 'scrgbClr'].includes(holder.name) ? holder : holder?.children[0]
  if (!c) return undefined
  let hex: string | undefined
  if (c.name === 'srgbClr') hex = /^[0-9a-f]{6}$/i.test(c.attrs.val ?? '') ? c.attrs.val.toUpperCase() : undefined
  else if (c.name === 'sysClr') hex = c.attrs.lastClr?.toUpperCase() ?? SYSTEM[c.attrs.val ?? '']
  else if (c.name === 'prstClr') hex = PRESET[c.attrs.val ?? '']
  else if (c.name === 'schemeClr') {
    const v = c.attrs.val ?? ''
    if (v === 'phClr') hex = ctx.placeholder
    else hex = ctx.theme.colors[ctx.clrMap[v] ?? v]
  }
  if (!hex) return undefined
  let alpha = 1
  let rgb = parse(hex)
  for (const m of c.children) {
    const v = num(m, 'val') / 100000
    if (m.name === 'alpha') alpha = v
    else if (m.name === 'lumMod' || m.name === 'lumOff') {
      const [h, s, l] = rgbToHsl(rgb)
      rgb = hslToRgb([h, s, m.name === 'lumMod' ? Math.min(1, l * v) : Math.min(1, l + v)])
    } else if (m.name === 'satMod') {
      const [h, s, l] = rgbToHsl(rgb)
      rgb = hslToRgb([h, Math.min(1, s * v), l])
    } else if (m.name === 'tint') rgb = rgb.map((x) => x * v + 255 * (1 - v)) as [number, number, number]
    else if (m.name === 'shade') rgb = rgb.map((x) => x * v) as [number, number, number]
  }
  return { hex: toHex(rgb), alpha }
}
