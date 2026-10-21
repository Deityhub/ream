// Changing what a page already has (Edit PDF's content mode): its lines of text, read with the font each was shown in
// so an edited line can be shown again in that font; its pictures, moved, resized or deleted in place; and areas
// erased. Only the page's own content stream is read: text and pictures inside forms aren't offered (Erase still
// reaches them).
import { PdfName, PdfRangeError, PdfStream, deflate, editDocument, type PdfDocument } from '@ream/pdf-core'
import { BoundsCtx, pageContent, type Box } from './bounds.ts'
import type { Font, Glyph } from './font.ts'
import { Interpreter, type ShownGlyph } from './interpreter.ts'
import { IDENTITY, apply, invert, mul, pageMatrix, type Matrix } from './matrix.ts'
import type { Ctx2D, Platform } from './platform.ts'
import { Redactor } from './redact.ts'

/** a box in points as the page is displayed (y down) */
export type ShownBox = { x0: number; y0: number; x1: number; y1: number }

/** a line of the page's text: letters on one baseline in one font, as displayed */
export type PageLine = {
  id: number
  text: string
  box: ShownBox
  /** where its baseline starts */
  baseline: [number, number]
  /** the size as displayed, points */
  size: number
  /** 0..1 each */
  colour: [number, number, number]
  face: string
  kind: 'sans' | 'serif' | 'mono'
  bold: boolean
  italic: boolean
  /** the letters its own font can show again ('' when the font can't be used again: a Type 3 font, one without a name) */
  letters: string
}

export type PagePictureItem = { id: number; box: ShownBox }

export type LineChange = {
  id: number
  /** '' takes the line out */
  text: string
  /** moved by, in displayed points */
  dx?: number
  dy?: number
  /** a new displayed size, points */
  size?: number
  colour?: [number, number, number]
  /** show the text again in the line's own font (every letter must be in its `letters`); otherwise the line is only taken out and the caller draws it */
  own: boolean
}

export type PageContentEdits = {
  lines?: LineChange[]
  /** areas whose text, shapes and pictures are taken out of the file */
  erase?: ShownBox[]
  /** a picture's new box, or null to take it out */
  pictures?: { id: number; box: ShownBox | null }[]
}

type Line = PageLine & { glyphs: ShownGlyph[]; userBox: Box }
type Picture = PagePictureItem & { start: number; end: number; ctm: Matrix }

const NO_PLATFORM: Platform = {
  imageFromRGBA: () => ({}) as CanvasImageSource,
  decodeJpeg: () => Promise.reject(new Error('not needed for analysis')),
}
const f4 = (v: number) => String(+v.toFixed(4))
const hex = (b: Uint8Array) => '<' + Array.from(b, (c) => c.toString(16).padStart(2, '0')).join('') + '>'
const union = (pts: [number, number][]): ShownBox => ({ x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) })

// ---------- which letters a font can show ----------

type Letters = Map<string, Uint8Array>
const lettersCache = new WeakMap<Font, Letters>()

/**
 * The letters a font can show, each with the code that shows it. An embedded font counts a letter only when it maps
 * the code to that text and has an outline for it (not an empty one, not its .notdef): a subset has only the letters
 * the file used. A font that isn't embedded counts every letter its encoding maps; the viewer supplies the shapes.
 */
export function fontLetters(font: Font): Letters {
  const known = lettersCache.get(font)
  if (known) return known
  const out: Letters = new Map()
  lettersCache.set(font, out)
  if (font.type3) return out
  const twoByte = font.decode(new Uint8Array([0, 65])).length === 1
  const all = new Uint8Array(twoByte ? 0x20000 : 256)
  if (twoByte) for (let c = 0; c < 0x10000; c++) (all[c * 2] = c >> 8), (all[c * 2 + 1] = c & 255)
  else all.forEach((_, c) => (all[c] = c))
  const shape = font.shape?.bind(font)
  const notdef = shape ? JSON.stringify(shape({ text: '', width: null, space: false, code: 0, bytes: twoByte ? 2 : 1 })?.path ?? null) : null
  const has = (g: Glyph) => {
    if (!shape) return true
    if (g.text === ' ') return true
    const s = shape(g)
    return !!s && s.path.length > 0 && JSON.stringify(s.path) !== notdef
  }
  for (const g of font.decode(all)) {
    if (!g.text || [...g.text].length !== 1 || out.has(g.text)) continue
    if (has(g)) out.set(g.text, twoByte ? new Uint8Array([g.code >> 8, g.code & 255]) : new Uint8Array([g.code]))
  }
  return out
}

// ---------- reading a page ----------

async function readPage(doc: PdfDocument, index: number): Promise<{ lines: Line[]; pictures: Picture[]; toShown: Matrix }> {
  const page = doc.pages()[index]
  const { box, rotate } = doc.pageBox(page)
  const toShown = pageMatrix(box as Box, rotate, 1)
  const { content, res } = await pageContent(doc, index)
  const interp = new Interpreter(doc, new BoundsCtx() as unknown as Ctx2D, NO_PLATFORM, IDENTITY)
  interp.analysis = true
  const glyphs: ShownGlyph[] = []
  const pictures: Picture[] = []
  let image: Matrix | null = null
  interp.onShow = (g) => glyphs.push(g)
  interp.onImage = (_, m) => {
    if (interp.depth === interp.recordDepth) image = m
  }
  interp.onOp = (o) => {
    if (image && (o.op === 'Do' || o.op === 'BI')) {
      const m = image
      const corners = ([[0, 0], [1, 0], [1, 1], [0, 1]] as const).map(([x, y]) => apply(toShown, ...apply(m, x, y)))
      pictures.push({ id: pictures.length, box: union(corners), start: o.start, end: o.end, ctm: m })
    }
    image = null
  }
  try {
    await interp.run(content, res, true)
  } catch {
    // what was read before the trouble is still offered
  }

  const lines: Line[] = []
  let cur: Line | null = null
  let end: [number, number] = [0, 0]
  const close = () => {
    if (cur && cur.text.trim() && !cur.glyphs.some((g) => !g.text)) lines.push({ ...cur, text: cur.text.replace(/\s+$/, ''), id: lines.length })
    cur = null
  }
  for (const g of glyphs) {
    const q = g.quad.map(([x, y]) => apply(toShown, x, y))
    // the baseline is a fifth of the way up the em box, which runs from a quarter em below it to one em above
    const at = (a: [number, number], b: [number, number]): [number, number] => [a[0] + (b[0] - a[0]) * 0.2, a[1] + (b[1] - a[1]) * 0.2]
    const b0 = at(q[0], q[3])
    const b1 = at(q[1], q[2])
    const size = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) / 1.25
    const upright = Math.abs(b1[1] - b0[1]) < 0.02 * Math.max(1, b1[0] - b0[0]) && q[3][1] < q[0][1] && b1[0] >= b0[0]
    if (!upright || g.renderMode === 3 || !size) {
      close()
      continue
    }
    const fits = (l: Line) => l.glyphs[0].fontName === g.fontName && l.glyphs[0].font === g.font && Math.abs(l.size - size) < size * 0.02 && Math.abs(l.baseline[1] - b0[1]) < size * 0.2 && b0[0] - end[0] > -size * 0.3 && b0[0] - end[0] < size * 1.5
    if (cur && fits(cur)) {
      const c: Line = cur
      if (b0[0] - end[0] > size * 0.2 && !c.text.endsWith(' ') && g.text !== ' ') c.text += ' '
      c.text += g.text
      c.glyphs.push(g)
      c.box = union([[c.box.x0, c.box.y0], [c.box.x1, c.box.y1], ...q])
      c.userBox = [Math.min(c.userBox[0], ...g.quad.map((p) => p[0])), Math.min(c.userBox[1], ...g.quad.map((p) => p[1])), Math.max(c.userBox[2], ...g.quad.map((p) => p[0])), Math.max(c.userBox[3], ...g.quad.map((p) => p[1]))]
    } else {
      close()
      const own = g.fontName && !g.font.type3 ? [...fontLetters(g.font).keys()].join('') : ''
      cur = {
        id: 0,
        text: g.text,
        box: union(q),
        baseline: b0,
        size,
        colour: g.fill,
        face: g.font.face,
        kind: g.font.kind,
        bold: g.font.bold,
        italic: g.font.italic,
        letters: own,
        glyphs: [g],
        userBox: [Math.min(...g.quad.map((p) => p[0])), Math.min(...g.quad.map((p) => p[1])), Math.max(...g.quad.map((p) => p[0])), Math.max(...g.quad.map((p) => p[1]))],
      }
    }
    end = b1
  }
  close()
  return { lines, pictures, toShown }
}

/** the page's lines of text and its pictures, for an editor to offer */
export async function pageContentItems(doc: PdfDocument, index: number): Promise<{ lines: PageLine[]; pictures: PagePictureItem[] }> {
  const { lines, pictures } = await readPage(doc, index)
  return {
    lines: lines.map(({ glyphs: _g, userBox: _u, ...l }) => l),
    pictures: pictures.map(({ id, box }) => ({ id, box })),
  }
}

type Share = { x: number; y: number; w: number; h: number }

/** the same, placed as fractions of the page as displayed (the line's baseline as its distance below the top of its box) */
export async function pageContentShares(doc: PdfDocument, index: number): Promise<{ lines: (Omit<PageLine, 'box' | 'baseline'> & { box: Share; baseline: number })[]; pictures: { id: number; box: Share }[] }> {
  const { width: W, height: H } = doc.pageSize(doc.pages()[index])
  const { lines, pictures } = await pageContentItems(doc, index)
  const share = (b: ShownBox): Share => ({ x: b.x0 / W, y: b.y0 / H, w: (b.x1 - b.x0) / W, h: (b.y1 - b.y0) / H })
  return {
    lines: lines.map((l) => ({ ...l, box: share(l.box), baseline: (l.baseline[1] - l.box.y0) / H })),
    pictures: pictures.map((p) => ({ id: p.id, box: share(p.box) })),
  }
}

// ---------- writing ----------

/** a line shown again in its own font, where it was (or moved), as content for the end of the page */
function ownLine(line: Line, c: LineChange, back: Matrix): string {
  const g = line.glyphs[0]
  const letters = fontLetters(g.font)
  const items: string[] = []
  let run: number[] = []
  const flush = () => run.length && (items.push(hex(new Uint8Array(run))), (run = []))
  for (const ch of c.text) {
    const code = letters.get(ch)
    if (code) run.push(...code)
    else if (ch === ' ') flush(), items.push('-250') // a quarter em, where the font has no space of its own
    else throw new PdfRangeError(`The line "${line.text.slice(0, 30)}" can't be shown in its own font: it has no "${ch}".`)
  }
  flush()
  const k = c.size ? c.size / line.size : 1
  const [r, gr, b] = c.colour ?? g.fill
  // the move is given as displayed: back into user space
  const [ux, uy] = apply(back, c.dx ?? 0, c.dy ?? 0)
  const [ox, oy] = apply(back, 0, 0)
  const move = c.dx || c.dy ? `1 0 0 1 ${f4(ux - ox)} ${f4(uy - oy)} cm ` : ''
  const colour = `${f4(r)} ${f4(gr)} ${f4(b)}`
  // ponytail: character and word spacing are reset, so a justified line comes back with ordinary spacing
  return `q ${move}${g.ctm.map(f4).join(' ')} cm BT /${g.fontName} ${f4(g.fontSize * k)} Tf ${f4(g.hScale * 100)} Tz ${f4(g.rise * k)} Ts ${g.renderMode} Tr 0 Tc 0 Tw ${colour} rg ${colour} RG ${g.tm.map(f4).join(' ')} Tm [${items.join(' ')}] TJ ET Q\n`
}

/**
 * A picture's operator drawn again in a new box (displayed), for the end of the page: where it was, it often sits in
 * a clip the size of its old place (Chromium prints each picture so), which would hide it once moved. It comes out on
 * top of the page, and without the opacity it had.
 */
function pictureOp(p: Picture, box: ShownBox, back: Matrix, content: Uint8Array): string {
  const from = [apply(back, p.box.x0, p.box.y0), apply(back, p.box.x1, p.box.y1)]
  const to = [apply(back, box.x0, box.y0), apply(back, box.x1, box.y1)]
  const lo = (a: [number, number][], i: 0 | 1) => Math.min(a[0][i], a[1][i])
  const span = (a: [number, number][], i: 0 | 1) => Math.abs(a[0][i] - a[1][i]) || 1
  const sx = span(to, 0) / span(from, 0)
  const sy = span(to, 1) / span(from, 1)
  // the map from the old box to the new one in user space, after the picture's own matrix (its unit square onto the page)
  const A: Matrix = [sx, 0, 0, sy, lo(to, 0) - lo(from, 0) * sx, lo(to, 1) - lo(from, 1) * sy]
  const op = Array.from(content.subarray(p.start, p.end), (ch) => String.fromCharCode(ch)).join('')
  return `q ${mul(p.ctm, A).map(f4).join(' ')} cm ${op} Q\n`
}

/** change pages' own text and pictures and erase areas; everything else in the file is kept */
export async function editContent(doc: PdfDocument, edits: Map<number, PageContentEdits>, platform: Platform): Promise<Uint8Array> {
  const read = new Map<number, Awaited<ReturnType<typeof readPage>>>()
  for (const index of edits.keys()) if (doc.pages()[index]) read.set(index, await readPage(doc, index))
  return editDocument(doc, async (e) => {
    for (const [index, change] of edits) {
      const pageRef = e.pageRefs[index]
      const page = doc.pages()[index]
      const info = read.get(index)
      if (!pageRef || !page || !info) continue
      const back = invert(info.toShown)
      let { content, res } = await pageContent(doc, index)
      const original = res

      // pictures first: their places are byte ranges of the content as it is; a moved one is drawn again at the end
      let redrawn = ''
      const moves = (change.pictures ?? []).flatMap((c) => {
        const p = info.pictures.find((x) => x.id === c.id)
        if (!p) return []
        if (c.box) redrawn += pictureOp(p, c.box, back, content)
        return [{ start: p.start, end: p.end, text: '' }]
      })
      if (moves.length) {
        const enc = new TextEncoder()
        const parts: Uint8Array[] = []
        let at = 0
        for (const m of moves.sort((a, b) => a.start - b.start)) {
          parts.push(content.subarray(at, m.start), enc.encode(` ${m.text} `))
          at = m.end
        }
        parts.push(content.subarray(at))
        content = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
        parts.reduce((i, p) => (content.set(p, i), i + p.length), 0)
      }
      // the page's own content in a q/Q pair, so the state it leaves can't move what is drawn after it; the moved
      // pictures go in before the passes below, so an erased area reaches them and their names are kept
      const enc = new TextEncoder()
      content = new Uint8Array([...enc.encode('q\n'), ...content, ...enc.encode(`\nQ\n${redrawn}`)])

      // lines: their letters out (by their middles, so the lines next to them are safe), then shown again in their own font
      const changed = (change.lines ?? []).flatMap((c) => {
        const l = info.lines.find((x) => x.id === c.id)
        return l ? [{ l, c }] : []
      })
      if (changed.length) {
        const r = await new Redactor(doc, e, changed.map(({ l }) => l.userBox), platform, { paths: false, images: false, centre: true }).stream(content, res, IDENTITY, 0)
        content = r.content
        res = r.res
      }
      const erase = (change.erase ?? []).map((b): Box => {
        const [p, q] = [apply(back, b.x0, b.y0), apply(back, b.x1, b.y1)]
        return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]
      })
      if (erase.length) {
        const r = await new Redactor(doc, e, erase, platform, { paths: true, images: true, centre: false, transparent: true }).stream(content, res, IDENTITY, 0)
        content = r.content
        res = r.res
      }
      const shown = changed.filter(({ c }) => c.own && c.text.trim()).map(({ l, c }) => ownLine(l, c, back)).join('')

      const body = new Uint8Array([...content, ...enc.encode(`\n${shown}`)])
      const dict = e.edit(pageRef)
      dict.set('Contents', e.add(new PdfStream(new Map([['Filter', new PdfName('FlateDecode')]]), await deflate(body))))
      if (res !== original || !page.dict.has('Resources')) dict.set('Resources', res)
    }
  })
}
