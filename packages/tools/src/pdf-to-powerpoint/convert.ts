import type { Slide, SlideBox, SlidePara, SlideShape } from '@ream/office-core'
import type { TextBlock } from '@ream/pdf-render'
import { hex, runOf } from '../pdf-to-word/convert.ts'

/** the paragraph a block of text is on a slide: one paragraph, its lines kept in step by an exact line height */
function paragraphOf(b: TextBlock): SlidePara {
  const hang = b.indentFirst < 0 ? -b.indentFirst : 0
  return {
    runs: b.runs.map(runOf),
    align: b.align,
    // a bullet that was a letter keeps its letter, colour and size; others become a plain one
    bullet: b.mark?.text ?? (b.bullet ? '•' : undefined),
    bulletColor: b.mark && b.mark.color.some((v) => v > 8) ? hex(b.mark.color) : undefined,
    bulletScale: b.mark && b.size ? Math.round((b.mark.size / b.size) * 100) / 100 : undefined,
    bulletFont: b.mark?.face || undefined,
    marginLeft: hang || undefined,
    indent: b.indentFirst || undefined,
    line: b.lines > 1 && b.leading ? Math.round(b.leading * 10) / 10 : undefined,
    before: 0,
    after: 0,
  }
}

/** a text block as a box in the same place: a little wider, so a stand-in for its font still fits each line */
export function boxOf(b: TextBlock): SlideBox {
  const w = b.x1 - b.x0
  const grow = Math.max(4, w * 0.04)
  const centred = b.align === 'center' || b.align === 'right'
  return {
    kind: 'text',
    // an exact line height puts the first baseline a little lower than the type size; start the box slightly higher to meet the original
    x: b.x0 - (centred ? grow : 0),
    y: b.y0 + 0.08 * b.size,
    w: w + (centred ? 2 * grow : grow),
    h: b.y1 - b.y0 + 2,
    paragraphs: [paragraphOf(b)],
    // lines kept from the page break where they did; a box that wrapped too would break them again where a stand-in font runs long
    wrap: !b.breaks,
    insets: [0, 0, 0, 0],
  }
}

/** a page as an editable slide: the page's design as a picture behind, its text in boxes where it was (`placedBlocks`) */
export function designSlide(blocks: TextBlock[], size: { width: number; height: number }, design: { bytes: Uint8Array; type: 'png' | 'jpeg' } | null): Slide {
  const shapes: SlideShape[] = []
  if (design) shapes.push({ kind: 'pic', x: 0, y: 0, w: size.width, h: size.height, ...design, alt: 'Page design' })
  for (const b of blocks) shapes.push(boxOf(b))
  return { shapes }
}

/** a slide made for a page of another size, scaled to fit the deck's slides and centred */
export function fitSlide(s: Slide, from: { width: number; height: number }, to: { width: number; height: number }): Slide {
  const k = Math.min(to.width / from.width, to.height / from.height)
  if (Math.abs(k - 1) < 1e-6 && from.width === to.width && from.height === to.height) return s
  const [dx, dy] = [(to.width - from.width * k) / 2, (to.height - from.height * k) / 2]
  const box = <T extends { x: number; y: number; w: number; h: number }>(b: T): T => ({ ...b, x: dx + b.x * k, y: dy + b.y * k, w: b.w * k, h: b.h * k })
  return {
    shapes: s.shapes.map((sh): SlideShape => {
      if (sh.kind === 'pic') return box(sh)
      if (sh.kind === 'text') return box({ ...sh, paragraphs: sh.paragraphs.map((p) => ({ ...p, line: p.line && p.line * k, marginLeft: p.marginLeft && p.marginLeft * k, indent: p.indent && p.indent * k, runs: p.runs.map((r) => ({ ...r, size: r.size && Math.round(r.size * k * 10) / 10 })) })) })
      return sh
    }),
  }
}
