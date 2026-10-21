// Drawing what a form field looks like: the picture (appearance stream) a viewer shows for a text box or a check box.
import { PdfRef, PdfStream, isName, name, type PdfDict, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'
import { ascii } from './bytes.ts'
import { encodeWinAnsi, textWidth } from './text.ts'

export type Look = {
  /** the font's name in the form's default resources, e.g. Helv */
  fontName: string
  /** points; 0 means as big as fits */
  size: number
  /** colour operators such as "0 g" */
  colour: string
  /** 0 left, 1 centre, 2 right */
  align: number
  multiline: boolean
  comb: boolean
  maxLength: number
  password: boolean
  background: string | null
  border: { colour: string; width: number } | null
}

export type FontLook = {
  name: string
  /** what goes under /Font in the appearance's resources */
  ref: PdfObj
  width(text: string, size: number): number
  encode(text: string): number[]
}

const hex = (codes: number[]) => '<' + codes.map((c) => c.toString(16).padStart(2, '0')).join('') + '>'
const n = (v: number) => String(Math.round(v * 1000) / 1000)
const strokeOf = (colour: string) => colour.replace(/(g|rg|k)$/, (m) => m.toUpperCase())

/**
 * The font an appearance will use. A simple Latin font from the form's resources keeps its own widths; anything else
 * (no such font, a symbol font, a CID font) is replaced by Helvetica, whose metrics we have.
 */
export function markFont(doc: PdfDocument, fontName: string, found: { ref: PdfObj; dict: PdfDict } | null, makeDefault: () => PdfRef): FontLook {
  const simple = found && (isName(doc.resolve(found.dict.get('Subtype')), 'Type1') || isName(doc.resolve(found.dict.get('Subtype')), 'TrueType'))
  const base = simple ? String(((doc.resolve(found!.dict.get('BaseFont')) as { value?: string } | null)?.value ?? '')) : ''
  const symbolic = /Symbol|Dingbats/i.test(base)
  if (!simple || symbolic) {
    const ref = makeDefault()
    return { name: fontName, ref, width: (t, s) => textWidth(t, s), encode: encodeWinAnsi }
  }
  const bold = /Bold|Black|Heavy/i.test(base)
  const first = doc.resolve(found!.dict.get('FirstChar'))
  const widths = doc.resolve(found!.dict.get('Widths'))
  const table = Array.isArray(widths) && typeof first === 'number' ? widths.map((w) => doc.resolve(w)).map((w) => (typeof w === 'number' ? w : 0)) : null
  return {
    name: fontName,
    ref: found!.ref,
    encode: encodeWinAnsi,
    width: (t, s) => (table && typeof first === 'number' ? (encodeWinAnsi(t).reduce((sum, c) => sum + (table[c - first] ?? 0), 0) * s) / 1000 : textWidth(t, s, { bold })),
  }
}

const ASCENT = 0.718
const DESCENT = 0.207

function form(w: number, h: number, content: string, resources: PdfDict): PdfStream {
  return new PdfStream(
    new Map<string, PdfObj>([['Type', name('XObject')], ['Subtype', name('Form')], ['BBox', [0, 0, w, h]], ['Resources', resources]]),
    ascii(content),
  )
}

function frame(w: number, h: number, look: Look): string {
  let out = ''
  if (look.background) out += `q ${look.background} 0 0 ${n(w)} ${n(h)} re f Q\n`
  if (look.border && look.border.width > 0) {
    const b = look.border.width
    out += `q ${strokeOf(look.border.colour)} ${n(b)} w ${n(b / 2)} ${n(b / 2)} ${n(w - b)} ${n(h - b)} re S Q\n`
  }
  return out
}

/** break text into lines no wider than `room`, at spaces; a word wider than a line is split by letters */
function wrap(text: string, room: number, width: (t: string) => number): string[] {
  const lines: string[] = []
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (!line || width(next) <= room) {
        line = next
        continue
      }
      lines.push(line)
      line = word
    }
    for (; line && width(line) > room && line.length > 1; ) {
      let cut = line.length - 1
      while (cut > 1 && width(line.slice(0, cut)) > room) cut--
      lines.push(line.slice(0, cut))
      line = line.slice(cut)
    }
    lines.push(line)
  }
  return lines
}

/** the picture of a text box or drop-down showing `text` */
export function textAppearance(w: number, h: number, text: string, look: Look, font: FontLook): PdfStream {
  const bw = look.border?.width ?? 0
  const pad = bw + 2
  const shown = look.password ? '*'.repeat([...text].length) : text
  const room = Math.max(1, w - 2 * pad)
  const wd = (t: string, s: number) => font.width(t, s)
  let size = look.size
  if (!size) size = look.multiline ? 12 : Math.max(4, Math.min(12, (h - 2 * pad) / 1.15))
  if (!look.size && !look.multiline && !look.comb) while (size > 4 && wd(shown, size) > room) size *= 0.95
  const lead = size * 1.15
  let body = ''
  const put = (line: string, x: number, y: number) => {
    body += `1 0 0 1 ${n(x)} ${n(y)} Tm ${hex(font.encode(line))} Tj\n`
  }
  if (shown) {
    if (look.comb) {
      const cells = look.maxLength
      const cw = (w - 2 * bw) / cells
      const y = (h - (ASCENT + DESCENT) * size) / 2 + DESCENT * size
      ;[...shown].slice(0, cells).forEach((ch, i) => put(ch, bw + i * cw + (cw - wd(ch, size)) / 2, y))
    } else if (look.multiline) {
      wrap(shown, room, (t) => wd(t, size)).forEach((line, i) => {
        const tw = wd(line, size)
        put(line, look.align === 1 ? (w - tw) / 2 : look.align === 2 ? w - pad - tw : pad, h - pad - ASCENT * size - i * lead)
      })
    } else {
      const tw = wd(shown, size)
      const y = (h - (ASCENT + DESCENT) * size) / 2 + DESCENT * size
      put(shown, look.align === 1 ? (w - tw) / 2 : look.align === 2 ? w - pad - tw : pad, y)
    }
  }
  const content = `${frame(w, h, look)}/Tx BMC\nq ${n(bw)} ${n(bw)} ${n(w - 2 * bw)} ${n(h - 2 * bw)} re W n\nBT\n${look.colour} /${font.name} ${n(size)} Tf\n${body}ET\nQ\nEMC\n`
  return form(w, h, content, new Map<string, PdfObj>([['Font', new Map<string, PdfObj>([[font.name, font.ref]])]]))
}

/** a circle as four Bézier curves */
const circle = (cx: number, cy: number, r: number) => {
  const k = 0.5523 * r
  return `${n(cx + r)} ${n(cy)} m ${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c ${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c ${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c ${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c`
}

/** the picture of a check box (a tick) or a radio button (a dot), on or off */
export function checkAppearance(w: number, h: number, look: Look, kind: 'checkbox' | 'radio', on: boolean): PdfStream {
  let content = ''
  const m = Math.min(w, h)
  if (kind === 'radio') {
    if (look.background) content += `q ${look.background} ${circle(w / 2, h / 2, m / 2)} f Q\n`
    if (look.border) content += `q ${strokeOf(look.border.colour)} ${n(look.border.width)} w ${circle(w / 2, h / 2, m / 2 - look.border.width / 2)} S Q\n`
    if (on) content += `q ${look.colour} ${circle(w / 2, h / 2, m * 0.22)} f Q\n`
  } else {
    content += frame(w, h, look)
    if (on) content += `q ${strokeOf(look.colour)} ${n(m * 0.12)} w 1 J 1 j ${n(w * 0.22)} ${n(h * 0.52)} m ${n(w * 0.42)} ${n(h * 0.27)} l ${n(w * 0.8)} ${n(h * 0.76)} l S Q\n`
  }
  return form(w, h, content, new Map())
}

/** the picture of a list box: its entries one per line from the top, the chosen one marked */
export function listAppearance(w: number, h: number, entries: string[], chosen: number, look: Look, font: FontLook): PdfStream {
  const bw = look.border?.width ?? 0
  const pad = bw + 2
  const size = look.size || 12
  const lead = size * 1.15
  let body = ''
  entries.forEach((entry, i) => {
    const top = h - bw - i * lead
    if (top - lead < bw) return
    if (i === chosen) body += `ET q 0.6 0.75 0.95 rg ${n(bw)} ${n(top - lead)} ${n(w - 2 * bw)} ${n(lead)} re f Q BT ${look.colour} /${font.name} ${n(size)} Tf\n`
    body += `1 0 0 1 ${n(pad)} ${n(top - lead + DESCENT * size + (lead - size) / 2)} Tm ${hex(font.encode(entry))} Tj\n`
  })
  const content = `${frame(w, h, look)}/Tx BMC\nq ${n(bw)} ${n(bw)} ${n(w - 2 * bw)} ${n(h - 2 * bw)} re W n\nBT\n${look.colour} /${font.name} ${n(size)} Tf\n${body}ET\nQ\nEMC\n`
  return form(w, h, content, new Map<string, PdfObj>([['Font', new Map<string, PdfObj>([[font.name, font.ref]])]]))
}
