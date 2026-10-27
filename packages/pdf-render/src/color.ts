import { PdfName, PdfStream, PdfString, decodeStream, isDict, type PdfDict, type PdfDocument, type PdfObj } from '@ream/pdf-core'
import { loadFunction, numbers } from './function.ts'

export type RGB = [number, number, number]

/**
 * A PDF colour space. Components are in the space's own range (gray, RGB and CMYK are 0..1); `rgb` returns 0..255.
 * `range` is the per-component range when it isn't 0..1 (Lab, Indexed).
 */
export type ColorSpace = {
  name: string
  n: number
  initial: number[]
  rgb(c: number[]): RGB
  range?: [number, number][]
  isPattern?: boolean
}

const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)

export const DeviceGray: ColorSpace = { name: 'DeviceGray', n: 1, initial: [0], rgb: ([g]) => [byte(g), byte(g), byte(g)] }
export const DeviceRGB: ColorSpace = { name: 'DeviceRGB', n: 3, initial: [0, 0, 0], rgb: ([r, g, b]) => [byte(r), byte(g), byte(b)] }
// A polynomial fit to a coated-SWOP print profile (the approach Firefox's PDF viewer takes). A plain (1-c)(1-k)
// formula makes pure inks far too vivid: cyan would be 0,255,255 where Acrobat and macOS show about 0,160-185,215-240.
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
export const DeviceCMYK: ColorSpace = {
  name: 'DeviceCMYK',
  n: 4,
  initial: [0, 0, 0, 1],
  rgb: ([c, m, y, k]) => [
    clamp255(255 + c * (-4.387332384609988 * c + 54.48615194189176 * m + 18.82290502165302 * y + 212.25662451639585 * k - 285.2331026137004) + m * (1.7149763477362134 * m - 5.6096736904047315 * y - 17.873870861415444 * k - 5.497006427196366) + y * (-2.5217340131683033 * y - 21.248923337353073 * k + 17.5119270841813) + k * (-21.86122147463605 * k - 189.48180835922747)),
    clamp255(255 + c * (8.841041422036149 * c + 60.118027045597366 * m + 6.871425592049007 * y + 31.159100130055922 * k - 79.2970844816548) + m * (-15.310361306967817 * m + 17.575251261109482 * y + 131.35250912493976 * k - 190.9453302588951) + y * (4.444339102852739 * y + 9.8632861493405 * k - 24.86741582555878) + k * (-20.737325471181034 * k - 187.80453709719578)),
    clamp255(255 + c * (0.8842522430003296 * c + 8.078677503112928 * m + 30.89978309703729 * y - 0.23883238689178934 * k - 14.183576799673286) + m * (10.49593273432072 * m + 63.02378494754052 * y + 50.606957656360734 * k - 112.23884253719248) + y * (0.03296041114873217 * y + 115.60384449646641 * k - 193.58209356861505) + k * (-22.33816807309886 * k - 180.12613974708367)),
  ],
}
export const PatternSpace: ColorSpace = { name: 'Pattern', n: 0, initial: [], rgb: () => [0, 0, 0], isPattern: true }

export const css = ([r, g, b]: RGB) => `rgb(${r},${g},${b})`

const byComponents = (n: number): ColorSpace => (n === 1 ? DeviceGray : n === 4 ? DeviceCMYK : DeviceRGB)

function lab(white: number[], range: number[]): ColorSpace {
  const [xw, yw, zw] = white
  const g = (t: number) => (t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29))
  const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055)
  return {
    name: 'Lab',
    n: 3,
    initial: [0, 0, 0],
    range: [[0, 100], [range[0], range[1]], [range[2], range[3]]],
    rgb([L, a, b]) {
      const fy = (L + 16) / 116
      // XYZ relative to the given white point, rescaled to D65 for sRGB
      const X = (xw * g(fy + a / 500) * 0.95047) / xw
      const Y = (yw * g(fy)) / yw
      const Z = (zw * g(fy - b / 200) * 1.08883) / zw
      return [
        byte(gamma(3.2406 * X - 1.5372 * Y - 0.4986 * Z)),
        byte(gamma(-0.9689 * X + 1.8758 * Y + 0.0415 * Z)),
        byte(gamma(0.0557 * X - 0.204 * Y + 1.057 * Z)),
      ]
    },
  }
}

const cache = new WeakMap<object, Promise<ColorSpace>>()

/** Resolve a colour space operand: a name (looked up in the resources' /ColorSpace dictionary when it isn't a device name) or an array. */
export async function loadColorSpace(doc: PdfDocument, obj: PdfObj | undefined, resources?: PdfDict): Promise<ColorSpace> {
  const o = doc.resolve(obj)
  if (o instanceof PdfName) {
    switch (o.value) {
      case 'DeviceGray': case 'G': case 'CalGray': return DeviceGray
      case 'DeviceRGB': case 'RGB': case 'CalRGB': return DeviceRGB
      case 'DeviceCMYK': case 'CMYK': return DeviceCMYK
      case 'Pattern': return PatternSpace
    }
    const table = resources && doc.resolve(resources.get('ColorSpace'))
    const named = isDict(table) ? table.get(o.value) : undefined
    if (named === undefined) return DeviceGray
    const target = doc.resolve(named)
    return target instanceof PdfName && target.value === o.value ? DeviceGray : loadColorSpace(doc, named, resources)
  }
  if (!Array.isArray(o) || o.length === 0) return DeviceGray
  const hit = cache.get(o)
  if (hit) return hit
  const made = build(doc, o, resources)
  cache.set(o, made)
  return made
}

async function build(doc: PdfDocument, a: PdfObj[], resources?: PdfDict): Promise<ColorSpace> {
  const family = doc.resolve(a[0])
  const kind = family instanceof PdfName ? family.value : ''
  switch (kind) {
    case 'CalGray': return DeviceGray
    case 'CalRGB': return DeviceRGB
    case 'Lab': {
      const d = doc.resolve(a[1])
      const white = (isDict(d) && numbers(doc, d.get('WhitePoint'))) || [0.9505, 1, 1.089]
      const range = (isDict(d) && numbers(doc, d.get('Range'))) || [-100, 100, -100, 100]
      return lab(white, range)
    }
    case 'ICCBased': {
      const s = doc.resolve(a[1])
      if (!(s instanceof PdfStream)) return DeviceRGB
      const alt = s.dict.get('Alternate')
      const n = doc.resolve(s.dict.get('N'))
      if (alt !== undefined) {
        const cs = await loadColorSpace(doc, alt, resources)
        if (typeof n !== 'number' || cs.n === n) return cs
      }
      return byComponents(typeof n === 'number' ? n : 3)
    }
    case 'Indexed': case 'I': {
      const base = await loadColorSpace(doc, a[1], resources)
      const hival = doc.resolve(a[2])
      const lookup = doc.resolve(a[3])
      const bytes = lookup instanceof PdfString ? lookup.bytes : lookup instanceof PdfStream ? await decodeStream(lookup) : new Uint8Array(0)
      const top = typeof hival === 'number' ? hival : 255
      const range = base.range ?? base.initial.map((): [number, number] => [0, 1])
      return {
        name: 'Indexed',
        n: 1,
        initial: [0],
        range: [[0, top]],
        rgb([i]) {
          const at = Math.min(top, Math.max(0, Math.round(i))) * base.n
          return base.rgb(base.initial.map((_, k) => range[k][0] + ((bytes[at + k] ?? 0) / 255) * (range[k][1] - range[k][0])))
        },
      }
    }
    case 'Separation': case 'DeviceN': {
      const names = doc.resolve(a[1])
      const n = kind === 'Separation' ? 1 : Array.isArray(names) ? names.length : 1
      const alt = await loadColorSpace(doc, a[2], resources)
      const tint = await loadFunction(doc, a[3])
      return {
        name: kind,
        n,
        initial: new Array(n).fill(1),
        rgb: (c) => alt.rgb(tint ? tint(c) : alt.initial),
      }
    }
    case 'Pattern': return PatternSpace
    default: return loadColorSpace(doc, a[0], resources)
  }
}
