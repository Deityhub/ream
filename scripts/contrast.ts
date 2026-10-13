// Checks the semantic colour tokens in packages/ui/src/theme.css against WCAG contrast.
// Usage: node scripts/contrast.ts   (exits 1 when a pair is below its minimum)
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../packages/ui/src/theme.css', import.meta.url), 'utf8')

const scale = new Map<string, string>()
for (const m of css.matchAll(/(--color-[a-z-]+-\d+):\s*(#[0-9a-f]{6})/gi)) scale.set(m[1], m[2])

const tokens = new Map<string, [string, string]>() // name -> [light, dark]
const resolve = (v: string) => {
  v = v.trim()
  const ref = /^var\((--[\w-]+)\)$/.exec(v)
  const hex = ref ? scale.get(ref[1]) : v
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`can't resolve ${v}`)
  return hex
}
// values are var(--x) or #hex, neither contains a comma, so splitting on the first one is enough
for (const m of css.matchAll(/(--[\w-]+):\s*light-dark\((.*)\);/g)) {
  const [light, dark] = m[2].split(',')
  tokens.set(m[1], [resolve(light), resolve(dark)])
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// [foreground, background, minimum]: 4.5 for text, 3 for icons and input borders
const pairs: [string, string, number][] = [
  ['--text', '--bg', 4.5], ['--text', '--surface', 4.5], ['--text', '--surface-2', 4.5],
  ['--text-muted', '--bg', 4.5], ['--text-muted', '--surface', 4.5], ['--text-muted', '--surface-2', 4.5],
  ['--on-accent', '--accent', 4.5], ['--on-accent', '--accent-hover', 4.5],
  ['--accent-ink', '--surface', 4.5], ['--accent-ink', '--accent-soft', 4.5], ['--accent-ink', '--bg', 4.5],
  ['--cat-pdf', '--cat-pdf-soft', 4.5], ['--cat-image', '--cat-image-soft', 4.5],
  ['--success', '--surface', 4.5],
  ['--danger', '--danger-soft', 4.5], ['--warning', '--warning-soft', 4.5],
  ['--accent', '--surface', 3], ['--accent', '--bg', 3],
  ['--border-field', '--surface', 3],
]

let failed = 0
for (const [i, mode] of ['light', 'dark'].entries()) {
  for (const [fg, bg, min] of pairs) {
    const a = tokens.get(fg)?.[i]
    const b = tokens.get(bg)?.[i]
    if (!a || !b) throw new Error(`missing token for ${fg} on ${bg}`)
    const r = ratio(a, b)
    const ok = r >= min
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`)
  }
}
if (failed) {
  console.error(`${failed} pair(s) below the minimum`)
  process.exit(1)
}
