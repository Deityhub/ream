import type { Slide, SlideBox, SlidePara, SlideShape, SlideTable, SlideTableCell } from '@ream/office-core'
import type { Block, PageBlocks, Table, TextBlock } from '@ream/pdf-render'
import { FACE, runOf } from '../pdf-to-word/convert.ts'

/** the paragraph a block of text is on a slide: one paragraph, its lines kept in step by an exact line height */
function paragraphOf(b: TextBlock): SlidePara {
  const hang = b.indentFirst < 0 ? -b.indentFirst : 0
  return {
    runs: b.runs.map(runOf),
    align: b.align,
    bullet: b.bullet ? '•' : undefined,
    marginLeft: hang || undefined,
    indent: b.indentFirst || undefined,
    line: b.lines > 1 && b.leading ? Math.round(b.leading * 10) / 10 : undefined,
    before: 0,
    after: 0,
  }
}

/** a text block as a box in the same place: wide enough that Word-like substitutes of its font still fit each line */
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
    wrap: true,
  }
}

export function tableOf(t: Table): SlideTable {
  const colWidths = t.xs.slice(1).map((x, i) => Math.max(6, x - t.xs[i]))
  const rowHeights = t.ys ? t.ys.slice(1).map((y, i) => Math.max(8, y - t.ys![i])) : Array.from({ length: t.rows }, (_, r) => Math.max(10, 1.5 * Math.max(0, ...t.cells.filter((c) => c.row === r).map((c) => c.size)) + 4))
  const at = new Map<string, Table['cells'][number]>()
  for (const c of t.cells) for (let r = 0; r < c.rows; r++) for (let k = 0; k < c.cols; k++) at.set(`${c.row + r}:${c.col + k}`, c)
  const cells: SlideTableCell[][] = []
  for (let r = 0; r < t.rows; r++) {
    const row: SlideTableCell[] = []
    for (let c = 0; c < t.cols; c++) {
      const cell = at.get(`${r}:${c}`)
      if (!cell) { row.push({ paragraphs: [], border: t.ruled }); continue }
      const h = c > cell.col
      const v = r > cell.row
      if (h || v) { row.push({ paragraphs: [], covered: h && v ? 'hv' : h ? 'h' : 'v', border: t.ruled }); continue }
      row.push({
        paragraphs: (cell.text ? cell.text.split('\n') : []).map((line) => ({ runs: [{ text: line, bold: cell.bold, size: cell.size || 10, font: FACE.sans }], align: cell.align })),
        cols: cell.cols > 1 ? cell.cols : undefined,
        rows: cell.rows > 1 ? cell.rows : undefined,
        border: t.ruled,
        anchor: 'top',
      })
    }
    cells.push(row)
  }
  return { kind: 'table', x: t.x0, y: t.y0, w: colWidths.reduce((a, b) => a + b, 0), h: rowHeights.reduce((a, b) => a + b, 0), colWidths, rowHeights, cells }
}

export type PictureFor = (b: Extract<Block, { kind: 'picture' }>) => { bytes: Uint8Array; type: 'png' | 'jpeg' } | null

/** a page as an editable slide: text boxes, tables and pictures where they were */
export function slideOf(p: PageBlocks, pictureFor: PictureFor): Slide {
  const shapes: SlideShape[] = []
  for (const b of p.blocks) {
    if (b.kind === 'text') shapes.push(boxOf(b))
    else if (b.kind === 'table') shapes.push(tableOf(b.table))
    else {
      const img = pictureFor(b)
      if (img) shapes.push({ kind: 'pic', x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, ...img })
    }
  }
  return { shapes }
}

