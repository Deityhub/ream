// Mapping Office font names onto the standard PDF fonts, and hex colours onto RGB. No engine imports.
const MONO = /courier|consolas|mono|menlo|lucida console|monaco|andale|typewriter|code/i
const SERIF = /times|georgia|cambria|garamond|palatino|book antiqua|baskerville|minion|constantia|bookman|century schoolbook|didot|charter|\bserif\b(?<!sans[- ]serif)|roman/i

/** the standard family that stands in for a font: serif, monospace or (the default) sans */
export const familyOf = (name?: string): 'sans' | 'serif' | 'mono' => (!name ? 'sans' : MONO.test(name) ? 'mono' : /sans/i.test(name) ? 'sans' : SERIF.test(name) ? 'serif' : 'sans')

/** "1F4E79" or "#1f4e79" -> [31, 78, 121]; anything else gives the fallback */
export function hexRgb(hex: string | undefined, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number] : fallback
}

/**
 * How wide a font's text runs compared with the standard font that stands in for it (Helvetica, Times, Courier): drawing
 * the stand-in with its glyphs squeezed by this much keeps line breaks and alignment where the original had them.
 * Rough averages for the common Office fonts; names not listed are taken as 1.
 */
const SCALES: [RegExp, number][] = [
  [/arial narrow|narrow/i, 0.82],
  [/calibri|candara|corbel|gill sans|segoe ui light/i, 0.9],
  [/verdana|century gothic|tahoma bold/i, 1.12],
  [/consolas|menlo|monaco|lucida console/i, 0.92],
  [/cambria|georgia|constantia|palatino|book antiqua/i, 1.06],
  [/trebuchet|segoe ui|open sans|roboto|source sans/i, 0.98],
]
export const widthScale = (name?: string): number => (name ? (SCALES.find(([re]) => re.test(name))?.[1] ?? 1) : 1)
