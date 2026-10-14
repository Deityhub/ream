import { PdfKeyword, PdfRef, PdfStream, PdfString, isDict, isName, type PdfDict, type PdfObj } from './objects.ts'
import { Parser, parseIndirectAt } from './parser.ts'
import { decodeStream } from './filters.ts'
import { PdfEncryptedError, PdfParseError, PdfPasswordError } from './errors.ts'
import { decryptObjects, openSecurity } from './security.ts'
import { ascii, indexOfBytes } from './bytes.ts'

type Entry = { kind: 'free' } | { kind: 'direct'; offset: number } | { kind: 'compressed'; stm: number }

export type Page = {
  ref: PdfRef | null
  dict: PdfDict
  /** Resources / MediaBox / CropBox / Rotate inherited from ancestor /Pages nodes (raw, may be refs) */
  inherited: PdfDict
}

const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate']
const unknownLength = () => NaN

// ponytail: every object is parsed up front; fine for normal files, make it lazy if huge PDFs hurt
export type LoadOptions = {
  /** user or owner password; the empty password is tried by default, which opens files that only restrict editing */
  password?: string
}

export class PdfDocument {
  objects: Map<number, PdfObj>
  trailer: PdfDict
  /** the file was encrypted; everything in `objects` is already decrypted */
  encrypted: boolean
  constructor(objects: Map<number, PdfObj>, trailer: PdfDict, encrypted = false) {
    this.objects = objects
    this.trailer = trailer
    this.encrypted = encrypted
  }

  static async load(bytes: Uint8Array, { password = '' }: LoadOptions = {}): Promise<PdfDocument> {
    const head = indexOfBytes(bytes.subarray(0, 1024), ascii('%PDF-'))
    if (head < 0) throw new PdfParseError("This file isn't a PDF.")
    try {
      return validate(await loadFromXref(bytes, password))
    } catch (e) {
      if (e instanceof PdfEncryptedError || e instanceof PdfPasswordError) throw e
      return validate(await rebuild(bytes, password))
    }
  }

  /** follow references until a direct value; unresolvable refs become null */
  resolve(o: PdfObj | undefined): PdfObj {
    let depth = 0
    while (o instanceof PdfRef && depth++ < 32) o = this.objects.get(o.num) ?? null
    return o === undefined || o instanceof PdfRef ? null : o
  }

  catalog(): PdfDict {
    const root = this.resolve(this.trailer.get('Root'))
    if (!isDict(root)) throw new PdfParseError("This PDF has no document catalog; the file may be damaged.")
    return root
  }

  /** the visible box (crop box, else media box) as [x1, y1, x2, y2] with x1 < x2 and y1 < y2, and the page rotation (0, 90, 180 or 270) */
  pageBox(page: Page): { box: [number, number, number, number]; rotate: number } {
    const get = (k: string) => this.resolve(page.dict.get(k) ?? page.inherited.get(k))
    const raw = get('CropBox') ?? get('MediaBox')
    const n = Array.isArray(raw) ? raw.map((v) => this.resolve(v)) : []
    const ok = n.length === 4 && n.every((v) => typeof v === 'number')
    const [x1, y1, x2, y2] = ok ? (n as number[]) : [0, 0, 612, 792] // US Letter when the file gives no usable box
    const r = get('Rotate')
    const rotate = typeof r === 'number' ? ((Math.round(r / 90) * 90) % 360 + 360) % 360 : 0
    return { box: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)], rotate }
  }

  /** displayed size in points: the crop box (or media box) with the page rotation applied */
  pageSize(page: Page): { width: number; height: number } {
    const { box, rotate } = this.pageBox(page)
    const [w, h] = [box[2] - box[0], box[3] - box[1]]
    return rotate % 180 === 90 ? { width: h, height: w } : { width: w, height: h }
  }

  pages(): Page[] {
    const out: Page[] = []
    const seen = new Set<PdfDict>()
    const walk = (node: PdfObj, inherited: PdfDict) => {
      const d = this.resolve(node)
      if (!isDict(d) || seen.has(d)) return
      seen.add(d)
      const kids = this.resolve(d.get('Kids'))
      if (Array.isArray(kids) && !isName(d.get('Type'), 'Page')) {
        const next: PdfDict = new Map(inherited)
        for (const k of INHERITED) if (d.has(k)) next.set(k, d.get(k) ?? null)
        for (const kid of kids) walk(kid, next)
      } else {
        out.push({ ref: node instanceof PdfRef ? node : null, dict: d, inherited })
      }
    }
    walk(this.catalog().get('Pages') ?? null, new Map())
    return out
  }
}

function validate(doc: PdfDocument): PdfDocument {
  if (!isDict(doc.resolve(doc.catalog().get('Pages')))) throw new PdfParseError("Couldn't find the pages in this PDF.")
  return doc
}

/** if the trailer names an /Encrypt dictionary, work out the key from the password and decrypt every object in place */
async function unlock(trailer: PdfDict, objects: Map<number, PdfObj>, gens: Map<number, number>, password: string): Promise<boolean> {
  if (!trailer.has('Encrypt')) return false
  const resolve = (o: PdfObj): PdfObj => (o instanceof PdfRef ? objects.get(o.num) ?? null : o)
  const ref = trailer.get('Encrypt') ?? null
  const enc = resolve(ref)
  if (!isDict(enc)) throw new PdfEncryptedError()
  const id = resolve(trailer.get('ID') ?? null)
  const id0 = Array.isArray(id) && id[0] instanceof PdfString ? id[0].bytes : new Uint8Array(0)
  const dec = await openSecurity(enc, id0, password, resolve)
  decryptObjects(objects, gens, dec, ref instanceof PdfRef ? ref.num : -1)
  trailer.delete('Encrypt')
  return true
}

// ---------- normal path: follow startxref ----------

async function loadFromXref(bytes: Uint8Array, password: string): Promise<PdfDocument> {
  const { entries, trailer } = await readXrefChain(bytes, findStartXref(bytes))

  const directLength = (num: number) => {
    const e = entries.get(num)
    if (e?.kind !== 'direct') return NaN
    try {
      const r = parseIndirectAt(bytes, e.offset, unknownLength)
      return typeof r.obj === 'number' ? r.obj : NaN
    } catch {
      return NaN
    }
  }
  const lengthOf = (o: PdfObj) => (typeof o === 'number' ? o : o instanceof PdfRef ? directLength(o.num) : NaN)

  const objects = new Map<number, PdfObj>()
  const gens = new Map<number, number>()
  for (const [num, e] of entries) {
    if (e.kind !== 'direct') continue
    const r = parseIndirectAt(bytes, e.offset, lengthOf)
    if (r.num !== num) throw new PdfParseError('The cross-reference table is wrong')
    objects.set(num, r.obj)
    gens.set(num, r.gen)
  }
  // decrypt before object streams are opened: their contents are plain only once the stream itself is decrypted
  const encrypted = await unlock(trailer, objects, gens, password)
  const stms = new Set<number>()
  for (const e of entries.values()) if (e.kind === 'compressed') stms.add(e.stm)
  for (const stm of stms) {
    const s = objects.get(stm)
    if (!(s instanceof PdfStream)) throw new PdfParseError('Missing object stream')
    await expandObjStm(s, (n) => {
      const e = entries.get(n)
      return e?.kind === 'compressed' && e.stm === stm
    }, objects)
  }
  return new PdfDocument(objects, trailer, encrypted)
}

function findStartXref(bytes: Uint8Array): number {
  const key = ascii('startxref')
  for (let i = bytes.length - key.length; i >= Math.max(0, bytes.length - 2048); i--) {
    let j = 0
    while (j < key.length && bytes[i + j] === key[j]) j++
    if (j === key.length) {
      const v = new Parser(bytes, i + key.length).readValue()
      if (typeof v === 'number') return v
      break
    }
  }
  throw new PdfParseError('No startxref found')
}

async function readXrefChain(bytes: Uint8Array, start: number): Promise<{ entries: Map<number, Entry>; trailer: PdfDict }> {
  const entries = new Map<number, Entry>()
  const seen = new Set<number>()
  let trailer: PdfDict | null = null
  let off: number | null = start
  while (off !== null && !seen.has(off)) {
    seen.add(off)
    const t = await readSection(bytes, off, entries)
    if (!trailer) trailer = new Map(t)
    else for (const k of ['Root', 'Info', 'ID', 'Encrypt']) if (!trailer.has(k) && t.has(k)) trailer.set(k, t.get(k) ?? null)
    const hybrid = t.get('XRefStm')
    if (typeof hybrid === 'number') await readSection(bytes, hybrid, entries)
    const prev = t.get('Prev')
    off = typeof prev === 'number' ? prev : null
  }
  if (!trailer) throw new PdfParseError('No trailer')
  return { entries, trailer }
}

/** read one xref table or xref stream at off; entries already present (newer) win */
async function readSection(bytes: Uint8Array, off: number, entries: Map<number, Entry>): Promise<PdfDict> {
  const p = new Parser(bytes, off)
  p.skipWs()
  if (p.startsWith('xref')) {
    p.pos += 4
    for (;;) {
      p.skipWs()
      if (p.startsWith('trailer')) break
      const first = p.readValue()
      const count = p.readValue()
      if (typeof first !== 'number' || typeof count !== 'number') throw new PdfParseError('Bad xref subsection')
      for (let i = 0; i < count; i++) {
        const offset = p.readValue()
        p.readValue()
        const kw = p.readValue()
        if (typeof offset !== 'number' || !(kw instanceof PdfKeyword)) throw new PdfParseError('Bad xref entry')
        if (!entries.has(first + i)) {
          entries.set(first + i, kw.value === 'n' && offset > 0 ? { kind: 'direct', offset } : { kind: 'free' })
        }
      }
    }
    p.pos += 7
    const t = p.readValue()
    if (!isDict(t)) throw new PdfParseError('Bad trailer')
    return t
  }
  const r = parseIndirectAt(bytes, off, (o) => (typeof o === 'number' ? o : NaN))
  if (!(r.obj instanceof PdfStream) || !isName(r.obj.dict.get('Type'), 'XRef')) throw new PdfParseError('Expected an xref stream')
  const dict = r.obj.dict
  const data = await decodeStream(r.obj)
  const w = dict.get('W')
  if (!Array.isArray(w) || w.length !== 3 || w.some((n) => typeof n !== 'number')) throw new PdfParseError('Bad xref stream /W')
  const [w0, w1, w2] = w as number[]
  const size = dict.get('Size')
  const index = (Array.isArray(dict.get('Index')) ? dict.get('Index') : [0, size]) as PdfObj[]
  const uint = (at: number, n: number) => {
    let v = 0
    for (let i = 0; i < n; i++) v = v * 256 + data[at + i]
    return v
  }
  let at = 0
  for (let s = 0; s + 1 < index.length; s += 2) {
    const first = index[s] as number
    const count = index[s + 1] as number
    for (let i = 0; i < count; i++, at += w0 + w1 + w2) {
      if (at + w0 + w1 + w2 > data.length) throw new PdfParseError('Truncated xref stream')
      const type = w0 > 0 ? uint(at, w0) : 1
      const f2 = uint(at + w0, w1)
      if (entries.has(first + i)) continue
      if (type === 1) entries.set(first + i, { kind: 'direct', offset: f2 })
      else if (type === 2) entries.set(first + i, { kind: 'compressed', stm: f2 })
      else entries.set(first + i, { kind: 'free' })
    }
  }
  return dict
}

async function expandObjStm(stm: PdfStream, accept: (num: number) => boolean, out: Map<number, PdfObj>) {
  const data = await decodeStream(stm)
  const n = stm.dict.get('N')
  const first = stm.dict.get('First')
  if (typeof n !== 'number' || typeof first !== 'number') throw new PdfParseError('Bad object stream')
  const head = new Parser(data)
  const pairs: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const num = head.readValue()
    const off = head.readValue()
    if (typeof num !== 'number' || typeof off !== 'number') throw new PdfParseError('Bad object stream header')
    pairs.push([num, off])
  }
  for (const [num, off] of pairs) {
    if (!accept(num)) continue
    const v = new Parser(data, first + off).readValue()
    if (!(v instanceof PdfKeyword)) out.set(num, v)
  }
}

// ---------- fallback: scan the whole file for "n g obj" ----------

async function rebuild(bytes: Uint8Array, password: string): Promise<PdfDocument> {
  const text = new TextDecoder('latin1').decode(bytes)
  const objects = new Map<number, PdfObj>()
  const gens = new Map<number, number>()
  const re = /(?<![\w.])(\d+)\s+(\d+)\s+obj\b/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    try {
      const r = parseIndirectAt(bytes, m.index, unknownLength)
      objects.set(r.num, r.obj)
      gens.set(r.num, r.gen)
      re.lastIndex = Math.max(re.lastIndex, r.end)
    } catch {
      // skip objects we can't read
    }
  }

  let trailer: PdfDict | null = null
  const tr = /trailer\s*<</g
  for (let m = tr.exec(text); m; m = tr.exec(text)) {
    try {
      const t = new Parser(bytes, m.index + 7).readValue()
      if (isDict(t) && t.has('Root')) trailer = t
    } catch {
      // ignore
    }
  }
  for (const o of objects.values()) {
    if (o instanceof PdfStream && isName(o.dict.get('Type'), 'XRef') && o.dict.has('Root')) trailer = o.dict
  }
  if (!trailer) {
    for (const [num, o] of objects) if (isDict(o) && isName(o.get('Type'), 'Catalog')) trailer = new Map([['Root', new PdfRef(num)]])
  }
  if (!trailer) throw new PdfParseError("Couldn't read this PDF; the file may be damaged.")

  // decrypt first, then open object streams: their contents are plain only once the stream itself is decrypted
  const encrypted = await unlock(trailer, objects, gens, password)
  for (const o of [...objects.values()]) {
    if (o instanceof PdfStream && isName(o.dict.get('Type'), 'ObjStm')) {
      try {
        await expandObjStm(o, (n) => !objects.has(n), objects)
      } catch {
        // damaged object stream: its objects are lost
      }
    }
  }
  return new PdfDocument(objects, trailer, encrypted)
}
