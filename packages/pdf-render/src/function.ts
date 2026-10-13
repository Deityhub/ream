// PDF function objects (ISO 32000-1 section 7.10): types 0 (sampled), 2 (exponential), 3 (stitching) and
// 4 (PostScript calculator). Used for tint transforms and shading colours.

import { PdfStream, isDict, type PdfDocument, type PdfObj } from '@ream/pdf-core'
import { decodeStream } from '@ream/pdf-core'

export type PdfFunction = (inputs: number[]) => number[]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** a numeric array with every element resolved, or null if it isn't one */
export function numbers(doc: PdfDocument, o: PdfObj | undefined): number[] | null {
  const a = doc.resolve(o)
  if (!Array.isArray(a)) return null
  const out = a.map((v) => doc.resolve(v))
  return out.every((v) => typeof v === 'number') ? (out as number[]) : null
}

/** clip `values` to pairs [lo, hi, lo, hi, ...] */
function clipTo(values: number[], pairs: number[] | null): number[] {
  return pairs ? values.map((v, i) => (pairs.length > 2 * i + 1 ? clamp(v, pairs[2 * i], pairs[2 * i + 1]) : v)) : values
}

export async function loadFunction(doc: PdfDocument, obj: PdfObj | undefined): Promise<PdfFunction | null> {
  const f = doc.resolve(obj)
  const dict = f instanceof PdfStream ? f.dict : isDict(f) ? f : null
  if (!dict) return null
  const type = doc.resolve(dict.get('FunctionType'))
  const domain = numbers(doc, dict.get('Domain')) ?? [0, 1]
  const range = numbers(doc, dict.get('Range'))

  if (type === 2) {
    const c0 = numbers(doc, dict.get('C0')) ?? [0]
    const c1 = numbers(doc, dict.get('C1')) ?? [1]
    const n = doc.resolve(dict.get('N'))
    const exp = typeof n === 'number' ? n : 1
    return (inputs) => {
      const x = clamp(inputs[0] ?? 0, domain[0], domain[1])
      const t = exp === 1 ? x : x ** exp
      return clipTo(c0.map((a, i) => a + t * ((c1[i] ?? a) - a)), range)
    }
  }

  if (type === 3) {
    const subs = doc.resolve(dict.get('Functions'))
    if (!Array.isArray(subs)) return null
    const fns = await Promise.all(subs.map((s) => loadFunction(doc, s)))
    if (fns.some((fn) => !fn)) return null
    const bounds = numbers(doc, dict.get('Bounds')) ?? []
    const encode = numbers(doc, dict.get('Encode')) ?? fns.flatMap(() => [0, 1])
    return (inputs) => {
      const x = clamp(inputs[0] ?? 0, domain[0], domain[1])
      let k = bounds.findIndex((b) => x < b)
      if (k < 0) k = fns.length - 1
      const lo = k === 0 ? domain[0] : bounds[k - 1]
      const hi = k >= bounds.length ? domain[1] : bounds[k]
      const e0 = encode[2 * k] ?? 0
      const e1 = encode[2 * k + 1] ?? 1
      const t = hi === lo ? e0 : e0 + ((x - lo) / (hi - lo)) * (e1 - e0)
      return clipTo(fns[k]!([t]), range)
    }
  }

  if (type === 0 && f instanceof PdfStream) return sampled(doc, f, domain, range)
  if (type === 4 && f instanceof PdfStream) return calculator(await decodeStream(f), domain, range)
  return null
}

// ---------- type 0: sampled ----------

async function sampled(doc: PdfDocument, f: PdfStream, domain: number[], range: number[] | null): Promise<PdfFunction | null> {
  const size = numbers(doc, f.dict.get('Size'))
  const bps = doc.resolve(f.dict.get('BitsPerSample'))
  if (!size || typeof bps !== 'number' || !range) return null
  const m = size.length
  const n = range.length / 2
  const encode = numbers(doc, f.dict.get('Encode')) ?? size.flatMap((s) => [0, s - 1])
  const decode = numbers(doc, f.dict.get('Decode')) ?? range
  const data = await decodeStream(f)
  const max = 2 ** bps - 1
  const sample = (index: number) => {
    // index counts samples; read bps bits at that position
    let bit = index * bps
    let v = 0
    for (let left = bps; left > 0; ) {
      const byte = data[bit >> 3] ?? 0
      const avail = 8 - (bit & 7)
      const take = Math.min(avail, left)
      v = v * 2 ** take + ((byte >> (avail - take)) & ((1 << take) - 1))
      bit += take
      left -= take
    }
    return v
  }
  return (inputs) => {
    // map each input into sample coordinates
    const pos = size.map((s, i) => {
      const x = clamp(inputs[i] ?? 0, domain[2 * i], domain[2 * i + 1])
      const d0 = domain[2 * i]
      const d1 = domain[2 * i + 1]
      const e = d1 === d0 ? encode[2 * i] : encode[2 * i] + ((x - d0) / (d1 - d0)) * (encode[2 * i + 1] - encode[2 * i])
      return clamp(e, 0, s - 1)
    })
    const out = new Array<number>(n).fill(0)
    // multilinear interpolation over the 2^m surrounding samples
    for (let corner = 0; corner < 1 << m; corner++) {
      let weight = 1
      let index = 0
      let stride = 1
      for (let i = 0; i < m; i++) {
        const lo = Math.floor(pos[i])
        const frac = pos[i] - lo
        const up = (corner >> i) & 1
        weight *= up ? frac : 1 - frac
        index += Math.min(size[i] - 1, lo + up) * stride
        stride *= size[i]
      }
      if (weight === 0) continue
      for (let j = 0; j < n; j++) out[j] += weight * sample(index * n + j)
    }
    return clipTo(out.map((v, j) => decode[2 * j] + (v / max) * (decode[2 * j + 1] - decode[2 * j])), range)
  }
}

// ---------- type 4: PostScript calculator ----------

type Node = number | string | Node[]

function parsePs(text: string): Node[] {
  const tokens = text.replace(/%[^\n\r]*/g, ' ').match(/[{}]|[^\s{}]+/g) ?? []
  let at = 0
  const block = (): Node[] => {
    const out: Node[] = []
    while (at < tokens.length) {
      const t = tokens[at++]
      if (t === '{') out.push(block())
      else if (t === '}') return out
      else out.push(/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? parseFloat(t) : t)
    }
    return out
  }
  at = tokens[0] === '{' ? 1 : 0
  return block()
}

function calculator(bytes: Uint8Array, domain: number[], range: number[] | null): PdfFunction | null {
  if (!range) return null
  const program = parsePs(new TextDecoder('latin1').decode(bytes))
  const nOut = range.length / 2
  return (inputs) => {
    const stack: (number | boolean)[] = inputs.map((v, i) => clamp(v, domain[2 * i], domain[2 * i + 1]))
    const num = () => {
      const v = stack.pop()
      return typeof v === 'boolean' ? Number(v) : (v ?? 0)
    }
    const run = (nodes: Node[]) => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        if (typeof node === 'number') {
          stack.push(node)
          continue
        }
        if (Array.isArray(node)) {
          // a procedure: only meaningful in front of if / ifelse
          const next = nodes[i + 1]
          if (next === 'if') {
            if (stack.pop()) run(node)
            i++
          } else if (Array.isArray(next) && nodes[i + 2] === 'ifelse') {
            run(stack.pop() ? node : next)
            i += 2
          }
          continue
        }
        switch (node) {
          case 'add': { const b = num(), a = num(); stack.push(a + b); break }
          case 'sub': { const b = num(), a = num(); stack.push(a - b); break }
          case 'mul': { const b = num(), a = num(); stack.push(a * b); break }
          case 'div': { const b = num(), a = num(); stack.push(b === 0 ? 0 : a / b); break }
          case 'idiv': { const b = Math.trunc(num()), a = Math.trunc(num()); stack.push(b === 0 ? 0 : Math.trunc(a / b)); break }
          case 'mod': { const b = Math.trunc(num()), a = Math.trunc(num()); stack.push(b === 0 ? 0 : a % b); break }
          case 'neg': stack.push(-num()); break
          case 'abs': stack.push(Math.abs(num())); break
          case 'ceiling': stack.push(Math.ceil(num())); break
          case 'floor': stack.push(Math.floor(num())); break
          case 'round': stack.push(Math.round(num())); break
          case 'truncate': stack.push(Math.trunc(num())); break
          case 'cvi': stack.push(Math.trunc(num())); break
          case 'cvr': break
          case 'sqrt': stack.push(Math.sqrt(Math.max(0, num()))); break
          case 'sin': stack.push(Math.sin((num() * Math.PI) / 180)); break
          case 'cos': stack.push(Math.cos((num() * Math.PI) / 180)); break
          case 'atan': { const den = num(), numr = num(); let d = (Math.atan2(numr, den) * 180) / Math.PI; if (d < 0) d += 360; stack.push(d); break }
          case 'exp': { const e = num(), b = num(); stack.push(b ** e); break }
          case 'ln': stack.push(Math.log(num())); break
          case 'log': stack.push(Math.log10(num())); break
          case 'eq': { const b = num(), a = num(); stack.push(a === b); break }
          case 'ne': { const b = num(), a = num(); stack.push(a !== b); break }
          case 'gt': { const b = num(), a = num(); stack.push(a > b); break }
          case 'ge': { const b = num(), a = num(); stack.push(a >= b); break }
          case 'lt': { const b = num(), a = num(); stack.push(a < b); break }
          case 'le': { const b = num(), a = num(); stack.push(a <= b); break }
          case 'true': stack.push(true); break
          case 'false': stack.push(false); break
          case 'and': { const b = stack.pop(), a = stack.pop(); stack.push(typeof a === 'boolean' && typeof b === 'boolean' ? a && b : Number(a) & Number(b)); break }
          case 'or': { const b = stack.pop(), a = stack.pop(); stack.push(typeof a === 'boolean' && typeof b === 'boolean' ? a || b : Number(a) | Number(b)); break }
          case 'xor': { const b = stack.pop(), a = stack.pop(); stack.push(typeof a === 'boolean' && typeof b === 'boolean' ? a !== b : Number(a) ^ Number(b)); break }
          case 'not': { const a = stack.pop(); stack.push(typeof a === 'boolean' ? !a : ~Number(a)); break }
          case 'bitshift': { const s = Math.trunc(num()), a = Math.trunc(num()); stack.push(s >= 0 ? a << s : a >> -s); break }
          case 'pop': stack.pop(); break
          case 'exch': { const b = stack.pop()!, a = stack.pop()!; stack.push(b, a); break }
          case 'dup': stack.push(stack[stack.length - 1] ?? 0); break
          case 'copy': { const n = Math.trunc(num()); if (n > 0 && n <= stack.length) stack.push(...stack.slice(-n)); break }
          case 'index': { const n = Math.trunc(num()); stack.push(stack[stack.length - 1 - n] ?? 0); break }
          case 'roll': {
            const j = Math.trunc(num()), n = Math.trunc(num())
            if (n > 0 && n <= stack.length) {
              const part = stack.splice(stack.length - n, n)
              const k = ((j % n) + n) % n
              stack.push(...part.slice(n - k), ...part.slice(0, n - k))
            }
            break
          }
        }
      }
    }
    run(program)
    const out = stack.slice(-nOut).map((v) => (typeof v === 'boolean' ? Number(v) : v))
    while (out.length < nOut) out.unshift(0)
    return clipTo(out, range)
  }
}
