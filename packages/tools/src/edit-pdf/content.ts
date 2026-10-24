// The page's own content in the editor: lines and pictures from the `content` host call made into items, and items
// made into what `editContent` takes, plus what is drawn on top instead (a line its own font can't show, a picture
// put in another's place). Plain functions, tested without a browser.
import type { PageContentEdits, ShownBox } from '@ream/pdf-render'
import type { Rect } from '../rect.ts'
import { lookAlikeFor } from '../fonts/match.ts'
import type { InstalledFont } from '../fonts/book.ts'
import type { PageChar } from './geometry.ts'
import { wrapLines } from './layout.ts'
import { FONTS, colourOf, lineBox, type ImageItem, type Item, type LineEditItem, type PictureEditItem, type TextItem } from './items.ts'

type Size = { width: number; height: number }

/** a line of the page as the host gives it: places as fractions of the page as displayed */
export type ContentLine = { id: number; text: string; box: Rect; baseline: number; size: number; colour: [number, number, number]; face: string; kind: 'sans' | 'serif' | 'mono'; bold: boolean; italic: boolean; letters: string }
export type ContentPicture = { id: number; box: Rect }
export type PageContent = { lines: ContentLine[]; pictures: ContentPicture[] }

export const hexOf = (c: [number, number, number]) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')

/** the bundled font that stands in for a line's own, as the saved file picks it: by the font's name, else by its kind */
export function lookalikeOf(face: string, kind: 'sans' | 'serif' | 'mono'): string {
  if (face) return FONTS.find((f) => f.family === lookAlikeFor(face))?.name ?? 'Arial'
  return kind === 'serif' ? 'Times New Roman' : kind === 'mono' ? 'Courier New' : 'Arial'
}

/** a font file was added (or found on the computer) for this family */
export const hasFontFor = (family: string, fonts: InstalledFont[]) => !!family && fonts.some((f) => (f.for ?? f.family).toLowerCase() === family.toLowerCase())

/**
 * The font a line is drawn in when its own embedded font can't show it: the one chosen, else its own family (a font
 * added for that family is used, or the saved file's font book picks the look-alike, as `lookalike` says).
 */
export const fallbackFont = (i: LineEditItem) => (i.font === 'own' ? i.face || i.lookalike : i.font)

/** a line of the page as an item, unchanged so far */
export function lineItem(id: string, page: number, l: ContentLine): LineEditItem {
  const colour = hexOf(l.colour)
  return { id, page, kind: 'textline', source: l.id, from: l.box, box: l.box, text: l.text, original: l.text, size: l.size, originalSize: l.size, colour, originalColour: colour, font: 'own', bold: l.bold, italic: l.italic, letters: l.letters, face: l.face, lookalike: lookalikeOf(l.face, l.kind), baseline: l.baseline }
}

/** the letters of the text its own font doesn't have (a space never counts: it is made with a move) */
export const missingLetters = (i: LineEditItem) => [...new Set([...i.text].filter((c) => c !== ' ' && !i.letters.includes(c)))]
/** shown in the PDF's own font */
export const usesOwn = (i: LineEditItem) => i.font === 'own' && !missingLetters(i).length

/** a picture of the page that was moved, resized, replaced or taken out */
export const pictureChanged = (i: PictureEditItem) => !!i.deleted || !!i.replace || i.box.x !== i.from.x || i.box.y !== i.from.y || i.box.w !== i.from.w || i.box.h !== i.from.h

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
        const font = fallbackFont(i)
        const [ascent, descent] = METRICS[font] ?? METRICS[i.lookalike] ?? METRICS.Arial
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

/**
 * The letters of a page as it looks now, for picking text to mark: the file's letters, less those of lines that were
 * changed, moved or taken out (they are not at their old place any more), plus the letters of the changed lines where
 * they are now. A line that was only moved brings its own letters along; one that was retyped or resized has its
 * letters laid out with `measure(font, bold, italic, size)`, the width of text in the font the editor draws it with
 * (the saved line may use another font, so a mark on it is approximate); boxes are as the file's letters have them,
 * from above the baseline to below it.
 */
export function liveChars(
  chars: PageChar[],
  items: Item[],
  page: number,
  size: { width: number; height: number },
  measure: (font: string, bold: boolean, italic: boolean, size: number) => (text: string) => number,
): PageChar[] {
  const changed = items.filter((i): i is LineEditItem => i.kind === 'textline' && i.page === page && lineChanged(i))
  const added = items.filter((i): i is TextItem => i.kind === 'text' && (i.page === page || !!i.everyPage) && !!i.text.trim())
  if (!changed.length && !added.length) return chars
  const inside = (c: PageChar, b: Rect) => {
    const [x, y] = [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2]
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
  }
  const out = chars.filter((c) => !changed.some((l) => inside(c, l.from)))
  for (const l of changed) {
    if (l.deleted) continue
    // only moved: its own letters, shifted, are exactly where the saved line puts them (its own font's widths)
    const mine = l.text === l.original && l.size === l.originalSize ? chars.filter((c) => inside(c, l.from)) : []
    if (mine.length) {
      const [dx, dy] = [l.box.x - l.from.x, l.box.y - l.from.y]
      for (const c of mine) out.push({ ...c, x0: c.x0 + dx, x1: c.x1 + dx, y0: c.y0 + dy, y1: c.y1 + dy })
      continue
    }
    const width = measure(fallbackFont(l), l.bold, l.italic, l.size)
    // the baseline, as far below the top of the line's box as it was, scaled with the size
    const base = l.box.y + (l.baseline * l.size) / l.originalSize
    const [y0, y1] = [base - (0.8 * l.size) / size.height, base + (0.2 * l.size) / size.height]
    const letters = [...l.text]
    let before = ''
    for (const ch of letters) {
      out.push({ text: ch, x0: l.box.x + width(before) / size.width, x1: l.box.x + width(before + ch) / size.width, y0, y1 })
      before += ch
    }
  }
  // text added to the page is not in the file: its letters are laid out as the editor draws them (the same line breaks, line
  // height and alignment) and mark like any other
  for (const t of added) {
    const width = measure(t.font, t.bold, t.italic, t.size)
    const [ascent, descent] = METRICS[t.font] ?? METRICS.Arial
    const { height, baseline } = lineBox(t.size, t.spacing, ascent, descent)
    const room = t.box.w * size.width
    wrapLines(t.text, room, width).forEach((line, k) => {
      const w = width(line)
      const left = t.box.x + (t.align === 'center' ? (room - w) / 2 : t.align === 'right' ? room - w : 0) / size.width
      const base = t.box.y + (k * height + baseline) / size.height
      const [y0, y1] = [base - (0.8 * t.size) / size.height, base + (0.2 * t.size) / size.height]
      let before = ''
      for (const ch of line) {
        out.push({ text: ch, x0: left + width(before) / size.width, x1: left + width(before + ch) / size.width, y0, y1 })
        before += ch
      }
    })
  }
  return out
}
