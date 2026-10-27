// Page-level edits that keep the original content: drawing on top of (or behind) pages, setting the visible box, and
// the document information. All built on compose(), so the result is a clean rewrite of the same pages.
import { PdfRef, PdfStream, isDict, name, type PdfDict, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'
import type { PdfBuilder } from './writer.ts'
import { compose } from './ops.ts'
import { PdfRangeError } from './errors.ts'
import { INFO_KEYS, pdfDate, readInfo } from './info.ts'
import { ascii } from './bytes.ts'
import type { UsedResources } from './content.ts'
import { embeddedResource, fontResource } from './text.ts'
import { addPrepared, type PreparedImage } from './images.ts'
import type { PreparedFont } from './ttf.ts'

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
  /** fonts made by `prepareFont` that the content draws with, by the name it uses (shown as /ReamEmb<Name>, see `embeddedResource`); one font used on every page is stored once */
  embedded?: Record<string, PreparedFont>
  /** pictures the content draws with `Do`, by the name it uses (shown as /Ream<Name>); one picture used on several pages is stored once */
  images?: Record<string, PreparedImage>
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

/** the matrix taking displayed coordinates (origin bottom left, y up, rotation applied) to the page's own user space */
export function displayedToUser(box: number[], rotate: number): [number, number, number, number, number, number] {
  const [x1, y1, x2, y2] = box
  const [w, h] = [x2 - x1, y2 - y1]
  return rotate === 90 ? [0, 1, -1, 0, x1 + w, y1] : rotate === 180 ? [-1, 0, 0, -1, x1 + w, y1 + h] : rotate === 270 ? [0, -1, 1, 0, x1, y1 + h] : [1, 0, 0, 1, x1, y1]
}

/** the same, as a content stream operator */
const toUserSpace = (box: number[], rotate: number): string => displayedToUser(box, rotate).join(' ') + ' cm'

/** draw `make(page)` on every page (return null to leave a page alone) */
export function stamp(doc: PdfDocument, make: (page: PageInfo) => Overlay | null): Uint8Array {
  const count = doc.pages().length
  const fontRefs = new Map<string, PdfRef>()
  const gsRefs = new Map<number, PdfRef>()
  const imageRefs = new Map<PreparedImage, PdfRef>()
  const embeddedRefs = new Map<PreparedFont, PdfRef>()
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
          if (overlay.embedded) {
            addTo(
              'Font',
              Object.entries(overlay.embedded).map(([n, f]) => {
                let ref = embeddedRefs.get(f)
                if (!ref) embeddedRefs.set(f, (ref = f.write(b)))
                return [embeddedResource(n), ref]
              }),
            )
          }
          if (overlay.images) {
            addTo(
              'XObject',
              Object.entries(overlay.images).map(([n, img]) => {
                let ref = imageRefs.get(img)
                if (!ref) imageRefs.set(img, (ref = addPrepared(b, img)))
                return [`Ream${n}`, ref]
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

/** page user space [x1, y1, x2, y2] */
export type Box4 = [number, number, number, number]

/** the visible box once the displayed margins are taken off, in the page's own (unrotated) space */
function croppedBox(box: Box4, rotate: number, [t, r, bo, l]: Margins, index: number): Box4 {
  // displayed margins -> user space sides [left, bottom, right, top]
  const [uL, uB, uR, uT] = rotate === 90 ? [t, l, bo, r] : rotate === 180 ? [r, t, l, bo] : rotate === 270 ? [bo, r, t, l] : [l, bo, r, t]
  const next: Box4 = [box[0] + uL, box[1] + uB, box[2] - uR, box[3] - uT]
  if (next[2] - next[0] < 1 || next[3] - next[1] < 1) throw new PdfRangeError(`Those margins leave nothing of page ${index + 1}.`)
  return next
}

/** the new visible box of every page the margins apply to (keyed by page index), in page user space */
export function cropBoxes(doc: PdfDocument, margins: (page: PageInfo) => Margins | null): Map<number, Box4> {
  const pages = doc.pages()
  const out = new Map<number, Box4>()
  pages.forEach((page, index) => {
    const { box, rotate } = doc.pageBox(page)
    const [w, h] = [box[2] - box[0], box[3] - box[1]]
    const turned = rotate % 180 === 90
    const m = margins({ index, count: pages.length, width: turned ? h : w, height: turned ? w : h })
    if (m) out.set(index, croppedBox(box, rotate, m, index))
  })
  return out
}

/** a page whose drawing instructions were rewritten to leave out what falls outside the crop */
export type PageRewrite = {
  /** the new content stream, already Flate-compressed */
  content: Uint8Array
  /** the resources the new content names; null keeps all of them */
  used: UsedResources | null
}

const BOXES_DROPPED = ['TrimBox', 'BleedBox', 'ArtBox', 'Thumb']

/** annotations whose rectangle lies entirely outside the box are dropped (links to something that can't be seen) */
function visibleAnnots(doc: PdfDocument, annots: PdfObj | undefined, keep: Box4): PdfObj[] | null {
  const list = doc.resolve(annots)
  if (!Array.isArray(list)) return null
  return list.filter((a) => {
    const d = doc.resolve(a)
    const r = isDict(d) ? doc.resolve(d.get('Rect')) : null
    const n = Array.isArray(r) ? r.map((v) => doc.resolve(v)) : []
    if (n.length !== 4 || !n.every((v) => typeof v === 'number')) return true
    const [x1, y1, x2, y2] = n as number[]
    return !(Math.max(x1, x2) < keep[0] || Math.min(x1, x2) > keep[2] || Math.max(y1, y2) < keep[1] || Math.min(y1, y2) > keep[3])
  })
}

/**
 * Show only the area left after taking the displayed margins off every page (return null for a page to leave it
 * alone). By default the rest is only hidden: the crop box is set and everything stays in the file. Pages named in
 * `rewrite` are cut for real: their page box becomes the new area, their content is the rewritten stream, resources
 * and annotations that only served the removed parts are not copied.
 */
export function crop(doc: PdfDocument, margins: (page: PageInfo) => Margins | null, options: { rewrite?: Map<number, PageRewrite> } = {}): Uint8Array {
  const boxes = cropBoxes(doc, margins)
  return compose(
    [
      {
        doc,
        pages: range(doc.pages().length),
        prepare(index, d) {
          const keep = boxes.get(index)
          const rw = options.rewrite?.get(index)
          if (!keep || !rw) return
          d.set('MediaBox', keep)
          d.set('CropBox', keep)
          for (const k of BOXES_DROPPED) d.delete(k)
          d.delete('Contents')
          const annots = visibleAnnots(doc, d.get('Annots'), keep)
          if (annots) d.set('Annots', annots)
          const res = doc.resolve(d.get('Resources'))
          if (rw.used && isDict(res)) {
            const pruned: PdfDict = new Map()
            for (const [kind, names] of Object.entries(rw.used.names)) {
              const sub = doc.resolve(res.get(kind))
              if (!isDict(sub)) continue
              const only: PdfDict = new Map()
              for (const n of names) if (sub.has(n)) only.set(n, sub.get(n) ?? null)
              pruned.set(kind, only)
            }
            if (rw.used.inlineImages && res.has('ColorSpace')) pruned.set('ColorSpace', res.get('ColorSpace') ?? null)
            d.set('Resources', pruned)
          }
        },
        edit(index, out, b) {
          const keep = boxes.get(index)
          if (!keep) return
          const rw = options.rewrite?.get(index)
          if (rw) out.set('Contents', b.add(new PdfStream(new Map<string, PdfObj>([['Filter', name('FlateDecode')]]), rw.content)))
          else out.set('CropBox', keep)
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
