// Where the bundled look-alike fonts come from. In the app each WOFF is its own lazily loaded piece of the bundle (as a
// data: URL inside a JS chunk, so it loads like the rest of the app); tests read the same files from disk.
import type { FontSource } from './book.ts'

export const browserFonts: FontSource = async (family, subset, weight, italic) => {
  const files = import.meta.glob('../../../../node_modules/@fontsource/{carlito,caladea,arimo,tinos,cousine}/files/*-{400,700}-*.woff', { query: '?inline', import: 'default' }) as Record<string, () => Promise<string>>
  const want = `/${family}-${subset}-${weight}-${italic ? 'italic' : 'normal'}.woff`
  const load = Object.entries(files).find(([path]) => path.endsWith(want))?.[1]
  if (!load) return null
  const url = await load()
  const b64 = url.slice(url.indexOf(',') + 1)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
