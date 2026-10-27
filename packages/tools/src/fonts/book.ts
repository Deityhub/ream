// The typefaces the converters draw with: a font the panel found on the computer, added from a file or downloaded, else a
// bundled look-alike with the same letter widths (Carlito for Calibri, Caladea for Cambria, Arimo for Arial, Tinos for
// Times New Roman, Cousine for Courier New), else the standard PDF font squeezed to the original's width.
import { FontFace, parseTtf, woffToSfnt, type FontSpec, type TtfFont } from '@ream/pdf-core'
import { familyOf, widthScale } from '../office-fonts.ts'
import { EXACT, MATCH, weightOf, type LookAlike } from './match.ts'

/**
 * A font file the panel found for the document: installed on the computer, added from a file or downloaded. `for` is the
 * family it stands for when that isn't its own name (Gill Sans for "Gill Sans Nova Light", a downloaded font). Several
 * files can share a family and style (a downloaded font's latin and latin-ext parts); they are used together.
 */
export type InstalledFont = { family: string; style: string; postscript: string; bytes: Uint8Array; for?: string; /** where it came from, for the panel */ source?: 'installed' | 'file' | 'download' }

/** the bundled web font file of a look-alike, e.g. ("carlito", "latin", 700, true) -> its WOFF bytes, or null when there is none */
export type FontSource = (family: string, subset: string, weight: 400 | 700, italic: boolean) => Promise<Uint8Array | null>

const FALLBACK: Record<'sans' | 'serif' | 'mono', LookAlike> = { sans: 'arimo', serif: 'tinos', mono: 'cousine' }
// scripts in the order they are tried; latin first, the others only when the text needs them
const SUBSETS = ['latin', 'latin-ext', 'vietnamese', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext', 'hebrew']

const italicStyle = (style: string) => /italic|oblique/i.test(style)
const key = (name: string, bold: boolean, italic: boolean) => `${name.toLowerCase()}|${bold ? 1 : 0}${italic ? 1 : 0}`

export type FontNeed = { name?: string; bold?: boolean; italic?: boolean; text: string }

export class FontBook {
  private source: FontSource
  private installed: InstalledFont[]
  private faces = new Map<string, { face: FontFace | null; scale: number }>()
  private files = new Map<string, Promise<TtfFont | null>>()
  /** fonts asked for that were drawn with a stand-in, for the panel to report */
  substituted = new Set<string>()

  constructor(source: FontSource, installed: InstalledFont[] = []) {
    this.source = source
    this.installed = installed
  }

  private file(family: LookAlike, subset: string, weight: 400 | 700, italic: boolean): Promise<TtfFont | null> {
    const k = `${family}/${subset}/${weight}/${italic}`
    let p = this.files.get(k)
    if (!p) {
      p = this.source(family, subset, weight, italic).then(async (b) => (b ? parseTtf(await woffToSfnt(b)) : null)).catch(() => null)
      this.files.set(k, p)
    }
    return p
  }

  /**
   * The files found for a family, in the style nearest the one asked for: the slant if there is one, then the weight
   * (bold asks for 700, else the weight in the family's name, so "Gill Sans Nova Light" takes Gill Sans Light). Files that
   * can't be embedded (licence, CID-keyed) are left out. Null when there are none.
   */
  private installedParts(name: string, bold: boolean, italic: boolean): TtfFont[] | null {
    const all = this.installed.filter((f) => (f.for ?? f.family).toLowerCase() === name.toLowerCase())
    if (!all.length) return null
    const slanted = all.filter((f) => italicStyle(f.style) === italic)
    const pool = slanted.length ? slanted : all
    const target = bold ? 700 : weightOf(name)
    const best = pool.reduce((a, f) => (Math.abs(weightOf(f.style) - target) < Math.abs(weightOf(a.style) - target) ? f : a))
    // a much heavier or lighter weight of the right family looks less like it than the look-alike does
    if (Math.abs(weightOf(best.style) - target) > 150) return null
    const parts: TtfFont[] = []
    for (const f of pool.filter((f) => f.style === best.style && f.family === best.family)) {
      try {
        parts.push(parseTtf(f.bytes, f.postscript))
      } catch {
        // a file that can't be embedded is skipped; the others (or the look-alike) are used
      }
    }
    return parts.length ? parts : null
  }

  /** get ready every face the text needs; after this `spec` answers at once */
  async load(needs: FontNeed[]): Promise<void> {
    const grouped = new Map<string, FontNeed & { bold: boolean; italic: boolean; chars: Set<string> }>()
    for (const n of needs) {
      const k = key(n.name ?? '', !!n.bold, !!n.italic)
      const g = grouped.get(k) ?? { ...n, bold: !!n.bold, italic: !!n.italic, chars: new Set<string>() }
      for (const ch of n.text) g.chars.add(ch)
      grouped.set(k, g)
    }
    for (const [k, g] of grouped) {
      if (this.faces.has(k)) continue
      const name = g.name ?? ''
      const own = name ? this.installedParts(name, g.bold, g.italic) : null
      const kind = familyOf(name)
      if (own) {
        this.faces.set(k, { face: new FontFace(own, kind), scale: 1 }); continue
      }
      const m = MATCH.find(([re]) => re.test(name))
      const family = m?.[1] ?? FALLBACK[kind]
      const scale = m ? m[2] : widthScale(name)
      if (name && !EXACT.test(name)) this.substituted.add(name)
      const parts: TtfFont[] = []
      const missing = (ch: string) => !parts.some((p) => p.glyphFor(ch.codePointAt(0)!))
      for (const subset of SUBSETS) {
        if (parts.length && ![...g.chars].some((ch) => ch.codePointAt(0)! > 32 && missing(ch))) break
        const f = await this.file(family, subset, g.bold ? 700 : 400, g.italic)
        if (f && (!parts.length || [...g.chars].some((ch) => missing(ch) && f.glyphFor(ch.codePointAt(0)!)))) parts.push(f)
      }
      this.faces.set(k, { face: parts.length ? new FontFace(parts, kind) : null, scale })
    }
  }

  /** the font to draw with, as `load` worked out (the standard font if it never ran) */
  spec(name: string | undefined, bold?: boolean, italic?: boolean): FontSpec {
    // `name` goes with the text into the PDF, so converting the PDF back names the font the file asked for
    const got = this.faces.get(key(name ?? '', !!bold, !!italic))
    if (got?.face) return { family: got.face.fallback, face: got.face, bold, italic, scale: got.scale, name }
    return { family: familyOf(name), bold, italic, scale: widthScale(name) }
  }
}
