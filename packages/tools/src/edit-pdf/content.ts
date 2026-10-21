// The page's own content in the editor: lines and pictures from the `content` host call made into items, and items
// made into what `editContent` takes, plus what is drawn on top instead (a line its own font can't show, a picture
// put in another's place). Plain functions, tested without a browser.
import type { PageContentEdits, ShownBox } from '@ream/pdf-render'
import type { Rect } from '../rect.ts'
import { colourOf, lineBox, type ImageItem, type Item, type LineEditItem, type TextItem } from './items.ts'

type Size = { width: number; height: number }

/** a line of the page as the host gives it: places as fractions of the page as displayed */
export type ContentLine = { id: number; text: string; box: Rect; baseline: number; size: number; colour: [number, number, number]; face: string; kind: 'sans' | 'serif' | 'mono'; bold: boolean; italic: boolean; letters: string }
export type ContentPicture = { id: number; box: Rect }
export type PageContent = { lines: ContentLine[]; pictures: ContentPicture[] }

export const hexOf = (c: [number, number, number]) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')

/** the bundled font that stands in for a line's own: by the font's name, else by its kind */
export function lookalikeOf(face: string, kind: 'sans' | 'serif' | 'mono'): string {
  if (/calibri|carlito/i.test(face)) return 'Calibri'
  if (/cambria|caladea/i.test(face)) return 'Cambria'
  if (/courier|cousine|mono/i.test(face)) return 'Courier New'
  if (/times|tinos|georgia|garamond|serif/i.test(face) && !/sans/i.test(face)) return 'Times New Roman'
  if (/arial|helvetica|arimo|sans/i.test(face)) return 'Arial'
  return kind === 'serif' ? 'Times New Roman' : kind === 'mono' ? 'Courier New' : 'Arial'
}

/** a line of the page as an item, unchanged so far */
export function lineItem(id: string, page: number, l: ContentLine): LineEditItem {
  const colour = hexOf(l.colour)
  return { id, page, kind: 'textline', source: l.id, from: l.box, box: l.box, text: l.text, original: l.text, size: l.size, originalSize: l.size, colour, originalColour: colour, font: 'own', bold: l.bold, italic: l.italic, letters: l.letters, lookalike: lookalikeOf(l.face, l.kind), baseline: l.baseline }
}

/** the letters of the text its own font doesn't have (a space never counts: it is made with a move) */
export const missingLetters = (i: LineEditItem) => [...new Set([...i.text].filter((c) => c !== ' ' && !i.letters.includes(c)))]
/** shown in the PDF's own font */
export const usesOwn = (i: LineEditItem) => i.font === 'own' && !missingLetters(i).length

export const lineChanged = (i: LineEditItem) =>
  !!i.deleted || i.text !== i.original || i.box.x !== i.from.x || i.box.y !== i.from.y || i.size !== i.originalSize || i.colour !== i.originalColour || i.font !== 'own'

// where each bundled font's ascent and descent are, as fractions of the size, to put a stand-in line on the old baseline
const METRICS: Record<string, [number, number]> = { Arial: [0.905, 0.212], 'Times New Roman': [0.891, 0.216], 'Courier New': [0.833, 0.3], Calibri: [0.952, 0.269], Cambria: [0.95, 0.222] }

const shown = (r: Rect, s: Size): ShownBox => ({ x0: r.x * s.width, y0: r.y * s.height, x1: (r.x + r.w) * s.width, y1: (r.y + r.h) * s.height })

/**
 * What the content items ask of each page, for `editContent`, and what is drawn over the pages instead: a line its
 * own font can't show (in its stand-in font, on its baseline) and a picture put in another's place.
 */
export function contentEdits(items: Item[], sizes: Size[]): { edits: Map<number, PageContentEdits>; draw: Item[] } {
  const edits = new Map<number, PageContentEdits>()
  const draw: Item[] = []
  const of = (page: number) => {
    let e = edits.get(page)
    if (!e) edits.set(page, (e = {}))
    return e
  }
  for (const i of items) {
    const s = sizes[i.page]
    if (!s) continue
    if (i.kind === 'textline' && lineChanged(i)) {
      const own = usesOwn(i)
      ;(of(i.page).lines ??= []).push({
        id: i.source,
        text: i.deleted ? '' : i.text,
        dx: (i.box.x - i.from.x) * s.width,
        dy: (i.box.y - i.from.y) * s.height,
        size: i.size,
        colour: colourOf(i.colour),
        own,
      })
      if (!own && !i.deleted && i.text.trim()) {
        const font = i.font === 'own' ? i.lookalike : i.font
        const [ascent, descent] = METRICS[font] ?? METRICS.Arial
        const base = (i.box.y + i.baseline) * s.height
        const top = base - lineBox(i.size, 1, ascent, descent).baseline
        const text: TextItem = { id: `${i.id}-text`, page: i.page, kind: 'text', box: { x: i.box.x, y: top / s.height, w: 1 - i.box.x, h: i.size / s.height }, text: i.text, font, size: i.size, colour: i.colour, bold: i.bold, italic: i.italic, align: 'left', spacing: 1, opacity: 1 }
        draw.push(text)
      }
    } else if (i.kind === 'picture') {
      const moved = i.box.x !== i.from.x || i.box.y !== i.from.y || i.box.w !== i.from.w || i.box.h !== i.from.h
      if (!i.deleted && !i.replace && !moved) continue
      ;(of(i.page).pictures ??= []).push({ id: i.source, box: i.deleted || i.replace ? null : shown(i.box, s) })
      if (i.replace && !i.deleted) draw.push({ id: `${i.id}-image`, page: i.page, kind: 'image', box: i.box, data: i.replace.data, type: i.replace.type, turns: 0, opacity: 1 } satisfies ImageItem)
    } else if (i.kind === 'erase') (of(i.page).erase ??= []).push(shown(i.box, s))
  }
  return { edits, draw }
}
