// Rewriting a whole PDF smaller without changing what it shows: only what is reachable from the catalog is kept,
// streams are compressed again, identical streams and fonts are stored once, and plain objects go into compressed
// object streams. Bookmarks, forms, links and everything else in the catalog come along untouched.
import { PdfName, PdfRef, PdfStream, PdfString, isName, name, type PdfDict, type PdfObj } from './objects.ts'
import { PdfBuilder, serializeCompact } from './writer.ts'
import { decodeUntilImage } from './filters.ts'
import { deflate } from './flate.ts'
import type { PdfDocument } from './document.ts'

export type OptimizeOptions = {
  /** a stream to write in place of one of the document's own, typically a pictures saved smaller */
  replace?: Map<PdfStream, PdfStream>
  /** write PDF 1.5 object streams and a cross-reference stream (default true) */
  objectStreams?: boolean
}

// page thumbnails and the private data of editing programs (an Illustrator file can sit inside a PDF) show nothing
const DROPPED_KEYS = new Set(['Thumb', 'PieceInfo'])

const isRef = (o: PdfObj | undefined): o is PdfRef => o instanceof PdfRef
const filtersOf = (s: PdfStream) => {
  const f = s.dict.get('Filter') ?? s.dict.get('F')
  return f == null ? [] : Array.isArray(f) ? f : [f]
}

/** the same stream with its data stored by Flate alone */
function flated(s: PdfStream, data: Uint8Array): PdfStream {
  const dict = new Map(s.dict)
  for (const k of ['Filter', 'F', 'DecodeParms', 'DP']) dict.delete(k)
  dict.set('Filter', name('FlateDecode'))
  return new PdfStream(dict, data)
}

/** try to store a stream's data in fewer bytes; the original comes back when nothing is gained or it can't be read */
async function recompress(s: PdfStream): Promise<PdfStream> {
  const type = s.dict.get('Type')
  if (isName(type, 'Metadata') || isName(type, 'XRef') || isName(type, 'ObjStm') || s.dict.has('F')) return s
  if (s.data.length < 48) return s
  const filters = filtersOf(s)
  let plain: Uint8Array
  if (!filters.length) plain = s.data
  else {
    try {
      const d = await decodeUntilImage(s)
      if (d.rest) return s // a picture codec (JPEG, CCITT ...): not ours to redo here
      plain = d.data
    } catch {
      return s
    }
  }
  const z = await deflate(plain)
  return z.length < s.data.length ? flated(s, z) : s
}

// ---------- identical objects ----------

const FNV = (data: Uint8Array, seed: number) => {
  let h = seed
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 16777619) >>> 0
  return h
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

// only objects whose identity doesn't matter are shared: pages, annotations, optional content groups and form fields
// are compared by reference by readers, so they stay separate even when they look alike
const SHAREABLE_TYPES = new Set(['Font', 'FontDescriptor', 'ExtGState', 'Encoding', 'Pattern', 'CMap'])
const SHAREABLE_SPACES = new Set(['ICCBased', 'Indexed', 'CalRGB', 'CalGray', 'Lab', 'Separation', 'DeviceN'])

function shareable(o: PdfObj): boolean {
  if (o instanceof PdfStream) return true
  if (o instanceof Map) {
    const t = o.get('Type')
    return (t instanceof PdfName && SHAREABLE_TYPES.has(t.value)) || o.has('FunctionType') || o.has('ShadingType') || o.has('PatternType')
  }
  return Array.isArray(o) && o[0] instanceof PdfName && SHAREABLE_SPACES.has(o[0].value)
}

/** a string that is equal for equal objects, with references replaced by what they are known to be the same as */
function keyOf(o: PdfObj, canon: number[]): string {
  if (o === null) return 'n'
  if (typeof o === 'number') return `#${o}`
  if (typeof o === 'boolean') return o ? 't' : 'f'
  if (o instanceof PdfName) return `/${o.value}`
  if (o instanceof PdfString) return `(${hex(o.bytes)})`
  if (o instanceof PdfRef) return `R${canon[o.num]}`
  if (Array.isArray(o)) return `[${o.map((x) => keyOf(x, canon)).join(' ')}]`
  if (o instanceof PdfStream) return `S${keyOf(o.dict, canon)}${o.data.length}:${FNV(o.data, 2166136261)}:${FNV(o.data, 3266489917)}`
  return `<${[...o].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${keyOf(v, canon)}`).join(',')}>`
}

/** for each object number the number of the first object identical to it (itself when it is the first) */
function findDuplicates(objects: (PdfObj | undefined)[]): number[] {
  const canon = Array.from({ length: objects.length + 1 }, (_, i) => i)
  // a font's descriptor can only match once its font file has been matched, so repeat until nothing more merges
  for (let pass = 0; pass < 5; pass++) {
    const seen = new Map<string, number>()
    let changed = false
    objects.forEach((o, i) => {
      const num = i + 1
      if (o === undefined || canon[num] !== num || !shareable(o)) return
      const key = keyOf(o, canon)
      const first = seen.get(key)
      if (first === undefined) seen.set(key, num)
      else {
        const a = objects[first - 1]
        // equal keys all but guarantee equal data; compare it anyway
        if (!(o instanceof PdfStream) || !(a instanceof PdfStream) || sameBytes(o.data, a.data)) {
          canon[num] = first
          changed = true
        }
      }
    })
    if (!changed) break
  }
  return canon
}

// ---------- the walk ----------

/** every reference inside an object, except those under keys that are dropped */
function refsIn(o: PdfObj, out: PdfRef[]) {
  const stack: PdfObj[] = [o]
  while (stack.length) {
    const x = stack.pop()!
    if (isRef(x)) out.push(x)
    else if (Array.isArray(x)) for (let i = x.length - 1; i >= 0; i--) stack.push(x[i])
    // a stream's /Length is written afresh, so a reference there (to a number object) isn't followed
    else if (x instanceof PdfStream) {
      for (const [k, v] of x.dict) if (k !== 'Length' && !DROPPED_KEYS.has(k)) stack.push(v)
    } else if (x instanceof Map) {
      for (const [k, v] of x) if (!DROPPED_KEYS.has(k)) stack.push(v)
    }
  }
}

function remap(o: PdfObj, renumber: (old: number) => number | null): PdfObj {
  if (isRef(o)) {
    const n = renumber(o.num)
    return n === null ? null : new PdfRef(n)
  }
  if (Array.isArray(o)) return o.map((x) => remap(x, renumber))
  if (o instanceof PdfStream) {
    const dict = remap(o.dict, renumber) as PdfDict
    dict.delete('Length')
    return new PdfStream(dict, o.data)
  }
  if (o instanceof Map) {
    const out = new Map<string, PdfObj>()
    for (const [k, v] of o) if (!DROPPED_KEYS.has(k)) out.set(k, remap(v, renumber))
    return out
  }
  return o
}

/** run `fn` over the items a few at a time */
async function inBatches<T>(items: T[], fn: (item: T, i: number) => Promise<void>, size = 8) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map((x, k) => fn(x, i + k)))
}

/** The document written again, smaller. Throws if the file has no catalog. */
export async function optimize(doc: PdfDocument, o: OptimizeOptions = {}): Promise<Uint8Array> {
  const root = doc.trailer.get('Root')
  if (!isRef(root)) throw new Error('The document has no catalog')
  const info = doc.trailer.get('Info')

  // 1. everything reachable from the catalog and the information dictionary, numbered in the order it is found
  const order: number[] = []
  const index = new Map<number, number>() // old number -> position in `order`
  const found = (r: PdfRef) => {
    if (index.has(r.num)) return false
    index.set(r.num, order.length)
    order.push(r.num)
    return true
  }
  const stack: PdfRef[] = isRef(info) ? [info, root] : [root]
  while (stack.length) {
    const r = stack.pop()!
    if (!found(r)) continue
    const own = doc.objects.get(r.num)
    const children: PdfRef[] = []
    refsIn(own === undefined ? null : (o.replace?.get(own as PdfStream) ?? own), children)
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  const renumber = (old: number) => {
    const at = index.get(old)
    return at === undefined || doc.objects.get(old) === undefined ? null : at + 1
  }
  let objects: PdfObj[] = order.map((old) => {
    const own = doc.objects.get(old) ?? null
    return remap(own instanceof PdfStream ? (o.replace?.get(own) ?? own) : own, renumber)
  })

  // 2. streams stored in fewer bytes
  const at: number[] = []
  objects.forEach((x, i) => x instanceof PdfStream && at.push(i))
  await inBatches(at, async (i) => {
    objects[i] = await recompress(objects[i] as PdfStream)
  })

  // 3. identical streams and fonts stored once
  const canon = findDuplicates(objects)
  const kept: number[] = []
  objects.forEach((_, i) => canon[i + 1] === i + 1 && kept.push(i + 1))
  const final = new Map(kept.map((old, i) => [old, i + 1]))
  const rewrite = (n: number) => final.get(canon[n]) ?? null
  objects = kept.map((old) => remap(objects[old - 1]!, rewrite))

  // 4. write
  const b = new PdfBuilder()
  b.objects = objects
  const newRoot = new PdfRef(rewrite(1)!)
  const newInfo = isRef(info) && index.has(info.num) ? new PdfRef(rewrite(index.get(info.num)! + 1)!) : undefined
  const id = doc.trailer.get('ID')
  const ids = Array.isArray(id) && id.every((x) => x instanceof PdfString) ? id : undefined
  if (o.objectStreams === false) return b.serialize(newRoot, newInfo)
  return serializeCompact(b, newRoot, newInfo, ids)
}
