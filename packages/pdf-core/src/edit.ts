// Page-level edits that keep the original content: drawing on top of (or behind) pages, setting the visible box, and
// the document information. All built on compose(), so the result is a clean rewrite of the same pages.
import { PdfRef, PdfStream, isDict, name, type PdfDict, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'
import type { PdfBuilder } from './writer.ts'
import { compose } from './ops.ts'
import { PdfRangeError } from './errors.ts'
import { INFO_KEYS, pdfDate, readInfo } from './info.ts'
import { ascii } from './bytes.ts'
import { fontResource } from './text.ts'

/** what a stamp is told about the page it draws on; sizes are as displayed (rotation applied), in points */
export type PageInfo = { index: number; count: number; width: number; height: number }

/**
 * Something to draw on a page. `content` is a PDF content stream fragment in displayed coordinates: origin at the
 * bottom left of the page as you see it, x to the right, y up, whatever the page's own rotation or box is.
 */
export type Overlay = {
  content: string
  /** base fonts the content uses, shown as /Ream<Name> (see fontResource) */
  fonts?: string[]
  /** 0..1; the content is drawn with this opacity */
  alpha?: number
  /** behind the page's own content instead of on top (hidden wherever the page paints an opaque background) */
  under?: boolean
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/** the info dictionary an edited file keeps: everything it had, with a new modification date */
const carried = (doc: PdfDocument, extra: Record<string, string> = {}) => ({ ...readInfo(doc), ModDate: pdfDate(), ...extra })

/** the builder's version of a value (a reference is followed, a direct value stays) */
const inBuilder = (b: PdfBuilder, o: PdfObj | undefined): PdfObj => (o instanceof PdfRef ? (b.objects[o.num - 1] ?? null) : (o ?? null))

/** matrix taking displayed coordinates to the page's own user space */
function toUserSpace(box: number[], rotate: number): string {
  const [x1, y1, x2, y2] = box
  const [w, h] = [x2 - x1, y2 - y1]
  const m = rotate === 90 ? [0, 1, -1, 0, x1 + w, y1] : rotate === 180 ? [-1, 0, 0, -1, x1 + w, y1 + h] : rotate === 270 ? [0, -1, 1, 0, x1, y1 + h] : [1, 0, 0, 1, x1, y1]
  return m.join(' ') + ' cm'
}

/** draw `make(page)` on every page (return null to leave a page alone) */
export function stamp(doc: PdfDocument, make: (page: PageInfo) => Overlay | null): Uint8Array {
  const count = doc.pages().length
  const fontRefs = new Map<string, PdfRef>()
  const gsRefs = new Map<number, PdfRef>()
  return compose(
    [
      {
        doc,
        pages: range(count),
        edit(index, out, b, source) {
          const { box, rotate } = doc.pageBox(source)
          const [w, h] = [box[2] - box[0], box[3] - box[1]]
          const turned = rotate % 180 === 90
          const overlay = make({ index, count, width: turned ? h : w, height: turned ? w : h })
          if (!overlay) return

          const alpha = overlay.alpha !== undefined && overlay.alpha < 1 ? overlay.alpha : undefined
          const body = `q\n${toUserSpace(box, rotate)}\n${alpha === undefined ? '' : '/ReamGS gs\n'}${overlay.content}\nQ\n`
          const addStream = (text: string) => b.add(new PdfStream(new Map(), ascii(text)))

          // keep the page's own stream(s) in a q/Q pair so whatever state they leave behind can't affect the stamp
          const current = inBuilder(b, out.get('Contents'))
          const own: PdfObj[] = Array.isArray(current) ? current : current ? [out.get('Contents') ?? null] : []
          out.set('Contents', overlay.under ? [addStream(body), ...own] : [addStream('q\n'), ...own, addStream('Q\n' + body)])

          const resources = new Map<string, PdfObj>(((r) => (isDict(r) ? r : new Map<string, PdfObj>()))(inBuilder(b, out.get('Resources'))))
          const addTo = (key: string, entries: [string, PdfRef][]) => {
            const existing = inBuilder(b, resources.get(key))
            const sub: PdfDict = new Map(isDict(existing) ? existing : [])
            for (const [k, v] of entries) sub.set(k, v)
            resources.set(key, sub)
          }
          if (overlay.fonts?.length) {
            addTo(
              'Font',
              overlay.fonts.map((f) => {
                let ref = fontRefs.get(f)
                if (!ref) {
                  ref = b.add(new Map<string, PdfObj>([['Type', name('Font')], ['Subtype', name('Type1')], ['BaseFont', name(f)], ['Encoding', name('WinAnsiEncoding')]]))
                  fontRefs.set(f, ref)
                }
                return [fontResource(f), ref]
              }),
            )
          }
          if (alpha !== undefined) {
            let ref = gsRefs.get(alpha)
            if (!ref) {
              ref = b.add(new Map<string, PdfObj>([['Type', name('ExtGState')], ['ca', alpha], ['CA', alpha]]))
              gsRefs.set(alpha, ref)
            }
            addTo('ExtGState', [['ReamGS', ref]])
          }
          out.set('Resources', resources)
        },
      },
    ],
    { info: carried(doc) },
  )
}

/** margins in points, as displayed: top, right, bottom, left */
export type Margins = [top: number, right: number, bottom: number, left: number]

/**
 * Hide the outer margins of every page by setting its crop box. The page content outside the box is still in the
 * file (the same as most PDF crop tools), it just isn't shown or printed.
 */
export function crop(doc: PdfDocument, margins: (page: PageInfo) => Margins | null): Uint8Array {
  const count = doc.pages().length
  return compose(
    [
      {
        doc,
        pages: range(count),
        edit(index, out, _b, source) {
          const { box, rotate } = doc.pageBox(source)
          const [w, h] = [box[2] - box[0], box[3] - box[1]]
          const turned = rotate % 180 === 90
          const m = margins({ index, count, width: turned ? h : w, height: turned ? w : h })
          if (!m) return
          const [t, r, bo, l] = m
          // displayed margins -> user space sides [left, bottom, right, top]
          const [uL, uB, uR, uT] = rotate === 90 ? [t, l, bo, r] : rotate === 180 ? [r, t, l, bo] : rotate === 270 ? [bo, r, t, l] : [l, bo, r, t]
          const next = [box[0] + uL, box[1] + uB, box[2] - uR, box[3] - uT]
          if (next[2] - next[0] < 1 || next[3] - next[1] < 1) throw new PdfRangeError(`Those margins leave nothing of page ${index + 1}.`)
          out.set('CropBox', next)
        },
      },
    ],
    { info: carried(doc) },
  )
}

export type Metadata = Partial<Record<(typeof INFO_KEYS)[number], string>>

/** the same pages with the given document information; an empty string removes that entry */
export function setMetadata(doc: PdfDocument, fields: Metadata): Uint8Array {
  const next: Record<string, string> = carried(doc)
  for (const [k, v] of Object.entries(fields)) {
    if (v) next[k] = v
    else delete next[k] // an emptied Producer falls back to Ream's own
  }
  return compose([{ doc, pages: range(doc.pages().length) }], { info: next })
}
