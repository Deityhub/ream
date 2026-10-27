// ToUnicode CMaps: how a font's character codes map to Unicode text.

export type ToUnicode = {
  /** byte lengths of the codes this CMap covers, from its codespace ranges (empty when it doesn't say) */
  codeLengths: number[]
  get(code: number): string | undefined
}

const hexToCode = (h: string) => parseInt(h, 16)

/** "<0041>" style UTF-16BE hex to a string */
function utf16(hex: string): string {
  const units: number[] = []
  for (let i = 0; i + 3 < hex.length + 1; i += 4) units.push(parseInt(hex.slice(i, i + 4).padEnd(4, '0'), 16))
  return String.fromCharCode(...units)
}

/** parse the text of a ToUnicode CMap stream */
export function parseToUnicode(text: string): ToUnicode {
  const single = new Map<number, string>()
  const ranges: { lo: number; hi: number; dst: string }[] = []
  const lists: { lo: number; hi: number; items: string[] }[] = []
  const lengths = new Set<number>()
  const hex = (s: string) => s.replace(/\s+/g, '')

  for (const block of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>/g)) lengths.add(Math.ceil(hex(m[1]).length / 2))
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]*)>/g)) single.set(hexToCode(hex(m[1])), utf16(hex(m[2])))
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    // either  <lo> <hi> <dst>  or  <lo> <hi> [<d1> <d2> ...]
    for (const m of block[1].matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*(?:<([0-9A-Fa-f\s]*)>|\[([^\]]*)\])/g)) {
      const lo = hexToCode(hex(m[1]))
      const hi = hexToCode(hex(m[2]))
      if (m[3] !== undefined) ranges.push({ lo, hi, dst: utf16(hex(m[3])) })
      else lists.push({ lo, hi, items: [...m[4].matchAll(/<([0-9A-Fa-f\s]*)>/g)].map((x) => utf16(hex(x[1]))) })
    }
  }

  return {
    codeLengths: [...lengths].sort((a, b) => a - b),
    get(code) {
      const s = single.get(code)
      if (s !== undefined) return s
      for (const r of ranges) {
        if (code >= r.lo && code <= r.hi && r.dst) {
          // the last UTF-16 unit counts up through the range
          return r.dst.slice(0, -1) + String.fromCharCode(r.dst.charCodeAt(r.dst.length - 1) + code - r.lo)
        }
      }
      for (const l of lists) if (code >= l.lo && code <= l.hi) return l.items[code - l.lo]
      return undefined
    },
  }
}
