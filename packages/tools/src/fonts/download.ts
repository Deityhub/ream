// Free fonts from Fontsource (Google Fonts and other openly licensed fonts), fetched only when the user asks. Only the
// font's name is sent; the document never leaves the device. No engine code: the panel calls it.
import type { InstalledFont } from './book.ts'
import { fontsourceId, weightOf, withoutWeight } from './match.ts'

const API = 'https://api.fontsource.org/v1/fonts/'
// ponytail: latin and latin-ext cover western European text; other scripts' parts are left for the bundled look-alikes
const SUBSETS = ['latin', 'latin-ext']
const STYLE_NAMES: Record<number, string> = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' }

type Meta = { id: string; family: string; weights: number[]; styles: string[]; subsets: string[]; license?: string; variants: Record<string, Record<string, Record<string, { url: { ttf?: string } }>>> }

const nearest = (weights: number[], target: number) => weights.reduce((a, w) => (Math.abs(w - target) < Math.abs(a - target) ? w : a), weights[0])

/**
 * A free font for a family the document uses: the weight its name asks for and bold, upright and italic, as TrueType
 * files. Null when Fontsource has no font of that name (most commercial fonts). `fetcher` is for tests.
 */
export async function downloadFreeFont(wanted: string, fetcher: typeof fetch = fetch): Promise<InstalledFont[] | null> {
  for (const id of [...new Set([fontsourceId(wanted), fontsourceId(withoutWeight(wanted))])]) {
    if (!id) continue
    const res = await fetcher(API + id)
    if (!res.ok) continue
    const meta = (await res.json()) as Meta
    if (!meta.weights?.length || !meta.variants) continue
    const weights = [...new Set([nearest(meta.weights, weightOf(wanted)), nearest(meta.weights, 700)])]
    const styles = meta.styles.filter((s) => s === 'normal' || s === 'italic')
    const files = weights.flatMap((w) => styles.flatMap((st) => SUBSETS.filter((sub) => meta.subsets.includes(sub)).map((sub) => ({ w, st, url: meta.variants[w]?.[st]?.[sub]?.url.ttf }))))
    const out: InstalledFont[] = []
    for (const f of files) {
      if (!f.url) continue
      const r = await fetcher(f.url)
      if (!r.ok) continue
      const style = `${STYLE_NAMES[f.w] ?? 'Regular'}${f.st === 'italic' ? ' Italic' : ''}`
      out.push({ family: meta.family, style, postscript: '', bytes: new Uint8Array(await r.arrayBuffer()), for: wanted, source: 'download' })
    }
    if (out.length) return out
  }
  return null
}
