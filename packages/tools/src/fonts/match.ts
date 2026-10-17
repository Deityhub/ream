// Which font stands for which: the bundled look-alikes, weights from style names, and finding a font the computer has
// under a slightly different name ("Gill Sans Nova Light" -> Gill Sans, Light). No engine code: panels use it too.
import { familyOf } from '../office-fonts.ts'

export type LookAlike = 'carlito' | 'caladea' | 'arimo' | 'tinos' | 'cousine'

/** the bundled look-alikes by the name the panel shows */
export const LOOK_ALIKE_NAMES: Record<LookAlike, string> = { carlito: 'Carlito', caladea: 'Caladea', arimo: 'Arimo', tinos: 'Tinos', cousine: 'Cousine' }

/** which look-alike stands in for a font, and how much wider the original runs than it */
export const MATCH: [RegExp, LookAlike, number][] = [
  [/calibri|candara|corbel|gill sans/i, 'carlito', 1],
  [/cambria|constantia|book antiqua|palatino|georgia/i, 'caladea', 1],
  [/aptos/i, 'arimo', 0.96],
  [/arial narrow/i, 'arimo', 0.82],
  [/verdana/i, 'arimo', 1.15],
  [/century gothic/i, 'arimo', 1.12],
  [/arial|helvetica|liberation sans|arimo|tahoma|trebuchet|segoe|open sans|roboto|source sans|lato|inter\b/i, 'arimo', 1],
  [/times|liberation serif|tinos|garamond|baskerville|minion/i, 'tinos', 1],
  [/consolas/i, 'cousine', 0.92],
  [/courier|liberation mono|cousine|menlo|monaco|lucida console|mono|code/i, 'cousine', 1],
]
/** fonts whose look-alike has exactly their widths: not worth telling the user about */
export const EXACT = /^(calibri|cambria|arial|helvetica|times new roman|times|courier new|courier)$/i

const WEIGHTS: [RegExp, number][] = [
  [/\b(hairline|thin)\b/i, 100], [/\b(extra|ultra)[ -]?light\b/i, 200], [/\blight\b/i, 300], [/\bbook\b/i, 350],
  [/\bmedium\b/i, 500], [/\b(semi|demi)[ -]?bold\b/i, 600], [/\b(extra|ultra)[ -]?bold\b/i, 800], [/\b(black|heavy)\b/i, 900], [/\bbold\b/i, 700],
]

/** the weight a style or font name says (400 when it says none) */
export const weightOf = (name: string): number => WEIGHTS.find(([re]) => re.test(name))?.[1] ?? 400

/** a name without its weight and width words: "Gill Sans Nova Light" -> "Gill Sans Nova" */
export const withoutWeight = (name: string) => name.replace(/\b((extra|ultra|semi|demi)[ -]?)?(hairline|thin|light|book|regular|medium|bold|black|heavy)\b/gi, '').replace(/\s+/g, ' ').trim()

/** words that make a different kind of type: a prefix without them is another font ("Century" is not "Century Gothic") */
const KIND = /\b(sans|serif|gothic|mono|script|slab|rounded|typewriter|hand|display|condensed|narrow|extended|wide)\b/i
/** words for editions of a family, safe to drop */
const EDITION = /^(nova|mt|std|pro|lt|ps|old|face|new|neue|next|text|ce|w0[0-9]|ef|com)$/i

/**
 * The family among `families` (installed or added) that a font the file asks for is, or is close to: the same name; else
 * the name less weight words; else the longest leading part of the name when only edition or weight words are left over.
 * `exact` says whether it is the same font.
 */
export function closestFamily(wanted: string, families: string[]): { family: string; exact: boolean } | null {
  const by = new Map(families.map((f) => [f.toLowerCase(), f]))
  const hit = by.get(wanted.toLowerCase())
  if (hit) return { family: hit, exact: true }
  const bare = withoutWeight(wanted)
  if (bare && by.has(bare.toLowerCase())) return { family: by.get(bare.toLowerCase())!, exact: false }
  const words = bare.split(' ')
  for (let k = words.length - 1; k >= 1; k--) {
    const rest = words.slice(k)
    const prefix = words.slice(0, k).join(' ')
    if (!rest.every((w) => EDITION.test(w)) || KIND.test(rest.join(' '))) continue
    if (prefix.length < 4) break
    const f = by.get(prefix.toLowerCase())
    if (f) return { family: f, exact: false }
  }
  return null
}

/** the Fontsource id of a family: "Libre Baskerville" -> "libre-baskerville" */
export const fontsourceId = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** the bundled look-alike a font is drawn with when nothing better is found */
export function lookAlikeFor(name: string): LookAlike {
  const m = MATCH.find(([re]) => re.test(name))
  if (m) return m[1]
  const kind = familyOf(name)
  return kind === 'serif' ? 'tinos' : kind === 'mono' ? 'cousine' : 'arimo'
}
