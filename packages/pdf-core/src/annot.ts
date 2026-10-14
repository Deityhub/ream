// How an annotation's picture (its normal appearance stream) is placed on the page. The renderer and Flatten both use
// this, so what you see and what gets baked into the page cannot disagree.
import { PdfName, PdfRef, PdfStream, isDict, type PdfDict, type PdfObj } from './objects.ts'
import type { PdfDocument } from './document.ts'

export type Matrix6 = [number, number, number, number, number, number]

const nums = (doc: PdfDocument, o: PdfObj | undefined): number[] | null => {
  const a = doc.resolve(o)
  if (!Array.isArray(a)) return null
  const n = a.map((v) => doc.resolve(v))
  return n.every((v) => typeof v === 'number') ? (n as number[]) : null
}

/** the annotation is meant to be seen: not hidden, not "no view", not a pop-up window */
export function isVisibleAnnotation(doc: PdfDocument, a: PdfDict): boolean {
  const flags = doc.resolve(a.get('F'))
  if (typeof flags === 'number' && (flags & 2 || flags & 32)) return false
  const sub = doc.resolve(a.get('Subtype'))
  return !(sub instanceof PdfName && sub.value === 'Popup')
}

/** where the stream drawn for the annotation as it is now is: /AP /N, or for a set of states the one /AS names; null when it has none */
export function normalAppearanceRef(doc: PdfDocument, a: PdfDict): PdfRef | null {
  const ap = doc.resolve(a.get('AP'))
  let raw = isDict(ap) ? ap.get('N') : undefined
  const states = doc.resolve(raw)
  if (isDict(states)) {
    const state = doc.resolve(a.get('AS'))
    raw = state instanceof PdfName ? states.get(state.value) : undefined
  }
  return raw instanceof PdfRef && doc.resolve(raw) instanceof PdfStream ? raw : null
}

export function normalAppearance(doc: PdfDocument, a: PdfDict): PdfStream | null {
  const ref = normalAppearanceRef(doc, a)
  return ref ? (doc.resolve(ref) as PdfStream) : null
}

/**
 * ISO 32000-1 algorithm 8.1: the matrix that takes the appearance's box (after its own /Matrix) onto the annotation's
 * rectangle. Prepend it to the stream's own matrix. Null when the annotation has no usable rectangle or box.
 */
export function appearanceMatrix(doc: PdfDocument, a: PdfDict, normal: PdfStream): Matrix6 | null {
  const rect = nums(doc, a.get('Rect'))
  const bbox = nums(doc, normal.dict.get('BBox'))
  if (!rect || rect.length !== 4 || !bbox || bbox.length !== 4) return null
  const mm = nums(doc, normal.dict.get('Matrix'))
  const m: Matrix6 = mm && mm.length === 6 ? (mm as Matrix6) : [1, 0, 0, 1, 0, 0]
  const at = (x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
  const corners = [at(bbox[0], bbox[1]), at(bbox[2], bbox[1]), at(bbox[0], bbox[3]), at(bbox[2], bbox[3])]
  const [bx0, bx1] = [Math.min(...corners.map((c) => c[0])), Math.max(...corners.map((c) => c[0]))]
  const [by0, by1] = [Math.min(...corners.map((c) => c[1])), Math.max(...corners.map((c) => c[1]))]
  const [rx0, rx1] = [Math.min(rect[0], rect[2]), Math.max(rect[0], rect[2])]
  const [ry0, ry1] = [Math.min(rect[1], rect[3]), Math.max(rect[1], rect[3])]
  const sx = bx1 > bx0 ? (rx1 - rx0) / (bx1 - bx0) : 1
  const sy = by1 > by0 ? (ry1 - ry0) / (by1 - by0) : 1
  return [sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy]
}
