// A small XML reader and writer for Office files (no DOMParser in workers). Prefixes are dropped: <a:t> and <w:t> both read as "t".
import { UserError } from '@ream/core'

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

const MAX_NODES = 2_000_000
const MAX_DEPTH = 200
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const local = (n: string) => n.slice(n.indexOf(':') + 1)
const unescape = (s: string) =>
  s.includes('&')
    ? s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
        if (e[0] !== '#') return ENTITIES[e] ?? m
        const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
      })
    : s

const bad = () => new UserError('Part of this file is not readable XML, so the file may be damaged.')

/** Parse a document. DOCTYPE (and with it custom entities) is refused; comments and processing instructions are skipped. */
export function parseXml(src: string): XmlNode {
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1)
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  let nodes = 0
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    const top = stack[stack.length - 1]
    if (lt < 0) {
      top.text += unescape(src.slice(i))
      break
    }
    if (lt > i) top.text += unescape(src.slice(i, lt))
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4)
      if (e < 0) throw bad()
      i = e + 3
    } else if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9)
      if (e < 0) throw bad()
      top.text += src.slice(lt + 9, e)
      i = e + 3
    } else if (src.startsWith('<?', lt)) {
      const e = src.indexOf('?>', lt + 2)
      if (e < 0) throw bad()
      i = e + 2
    } else if (src.startsWith('<!', lt)) {
      throw new UserError('This file uses XML features that are not supported.')
    } else if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt)
      if (e < 0 || stack.length < 2 || local(src.slice(lt + 2, e).trim()) !== top.name) throw bad()
      stack.pop()
      i = e + 1
    } else {
      // an open tag: name, attributes, then > or />. Attribute values may hold '>', so scan quotes.
      let j = lt + 1
      while (j < src.length && !/[\s/>]/.test(src[j])) j++
      const node: XmlNode = { name: local(src.slice(lt + 1, j)), attrs: {}, children: [], text: '' }
      if (!node.name) throw bad()
      for (;;) {
        while (j < src.length && /\s/.test(src[j])) j++
        if (j >= src.length) throw bad()
        if (src[j] === '>' || (src[j] === '/' && src[j + 1] === '>')) break
        const eq = src.indexOf('=', j)
        if (eq < 0) throw bad()
        const key = src.slice(j, eq).trim()
        let q = eq + 1
        while (q < src.length && /\s/.test(src[q])) q++
        const quote = src[q]
        const end = quote === '"' || quote === "'" ? src.indexOf(quote, q + 1) : -1
        if (end < 0) throw bad()
        if (!key.startsWith('xmlns')) node.attrs[local(key)] = unescape(src.slice(q + 1, end))
        j = end + 1
      }
      if (++nodes > MAX_NODES) throw new UserError('This file is too complex to read.')
      top.children.push(node)
      if (src[j] === '/') i = j + 2
      else {
        if (stack.length > MAX_DEPTH) throw bad()
        stack.push(node)
        i = j + 1
      }
    }
  }
  if (stack.length !== 1 || root.children.length !== 1) throw bad()
  return root.children[0]
}

/** the first direct child called `name` */
export const child = (n: XmlNode | undefined, name: string): XmlNode | undefined => n?.children.find((c) => c.name === name)
/** all direct children called `name` */
export const kids = (n: XmlNode | undefined, name: string): XmlNode[] => n?.children.filter((c) => c.name === name) ?? []
/** follow a path of child names */
export const dig = (n: XmlNode | undefined, ...path: string[]): XmlNode | undefined => path.reduce<XmlNode | undefined>((a, p) => child(a, p), n)
/** a number attribute, or the fallback */
export const num = (n: XmlNode | undefined, attr: string, fallback = 0): number => {
  const v = Number(n?.attrs[attr])
  return n?.attrs[attr] !== undefined && Number.isFinite(v) ? v : fallback
}

// eslint-disable-next-line no-control-regex -- XML 1.0 forbids these characters even as references
const INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g

/** text safe inside an element or an attribute; characters XML cannot hold (stray control codes from PDFs) are dropped */
export const esc = (s: string): string =>
  s.replace(INVALID, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** a number written the way XML expects (no exponent, at most 4 decimals) */
export const fmt = (n: number): string => String(Math.round(n * 1e4) / 1e4)
