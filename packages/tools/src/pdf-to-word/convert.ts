import type { DocBlock, DocSection, DocTableCell, Paragraph, Run } from '@ream/office-core'
import type { Block, BlockRun, PageBlocks, Table, TextBlock } from '@ream/pdf-render'

export const FACE = { sans: 'Arial', serif: 'Times New Roman', mono: 'Courier New' } as const

export const hex = (c: [number, number, number]) => c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()

export function runOf(r: BlockRun): Run {
  return { text: r.text, bold: r.bold, italic: r.italic, size: r.size, font: r.face || FACE[r.kind], color: r.color.every((v) => v < 8) ? undefined : hex(r.color) }
}

export function paragraphOf(b: TextBlock): Paragraph {
  return {
    kind: 'p',
    runs: b.runs.map(runOf),
    align: b.align,
    heading: b.heading,
    bullet: b.bullet,
    after: Math.round(b.after * 10) / 10,
    line: b.leading ? Math.round(b.leading * 10) / 10 : undefined,
    indentLeft: b.indentLeft || undefined,
    indentFirst: b.indentFirst || undefined,
  }
}

/** a found table as a Word table: column widths from the page, merged cells as spans, the lines kept when the table was drawn with them */
export function tableOf(t: Table, after: number): DocBlock {
  const colWidths = t.xs.slice(1).map((x, i) => Math.max(8, x - t.xs[i]))
  // what covers each grid position: the cell that starts there, or one that spans over it
  const at = new Map<string, { cell: Table['cells'][number]; first: boolean }>()
  for (const c of t.cells) for (let r = 0; r < c.rows; r++) for (let k = 0; k < c.cols; k++) at.set(`${c.row + r}:${c.col + k}`, { cell: c, first: r === 0 && k === 0 })
  const rows: DocTableCell[][] = []
  for (let r = 0; r < t.rows; r++) {
    const row: DocTableCell[] = []
    for (let c = 0; c < t.cols; c++) {
      const hit = at.get(`${r}:${c}`)
      if (!hit) { row.push({ paragraphs: [] }); continue }
      const { cell } = hit
      if (c > cell.col) continue // the rest of a cell that spans columns
      const spanCols = cell.cols > 1 ? cell.cols : undefined
      if (r > cell.row) { row.push({ paragraphs: [], cols: spanCols, vMerge: 'continue' }); continue }
      const lines = cell.text ? cell.text.split('\n') : []
      row.push({
        paragraphs: lines.map((line) => ({ kind: 'p' as const, runs: [{ text: line, bold: cell.bold, size: cell.size || 10, font: FACE.sans }], align: cell.align })),
        cols: spanCols,
        vMerge: cell.rows > 1 ? 'restart' : undefined,
      })
    }
    rows.push(row)
  }
  const rowHeights = t.ys?.slice(1).map((y, i) => Math.max(0, y - t.ys![i]))
  return { kind: 'table', colWidths, rows, rowHeights, borders: t.ruled, after }
}

export type PictureFor = (b: Extract<Block, { kind: 'picture' }>) => { bytes: Uint8Array; type: 'png' | 'jpeg' } | null

/** a page's blocks as one section of the document: the page's own size, margins from where its content sits */
export function sectionOf(p: PageBlocks, pictureFor: PictureFor): DocSection {
  const cap = (v: number, dim: number) => Math.max(0, Math.min(v, dim * 0.45))
  const content = p.width - cap(p.margins.left, p.width) - cap(p.margins.right, p.width)
  const blocks: DocBlock[] = []
  for (const b of p.blocks) {
    if (b.kind === 'text') blocks.push(paragraphOf(b))
    else if (b.kind === 'table') blocks.push(tableOf(b.table, b.after))
    else {
      const img = pictureFor(b)
      if (!img) continue
      const w = b.x1 - b.x0
      const h = b.y1 - b.y0
      if (b.background) blocks.push({ kind: 'picture', ...img, width: w, height: h, at: { x: b.x0, y: b.y0 } })
      else {
        const k = Math.min(1, content / w)
        blocks.push({ kind: 'picture', ...img, width: w * k, height: h * k })
      }
    }
  }
  return {
    width: p.width,
    height: p.height,
    // room below the last line: Word sets type a little differently, and a page that is exactly full spills onto the next
    margins: { top: cap(p.margins.top, p.height), left: cap(p.margins.left, p.width), right: cap(p.margins.right, p.width), bottom: Math.min(18, cap(p.margins.bottom, p.height)) },
    blocks,
  }
}
