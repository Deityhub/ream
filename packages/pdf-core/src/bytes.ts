export function latin1(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192))
  return s
}

export function ascii(s: string): Uint8Array {
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255
  return b
}

export function indexOfBytes(data: Uint8Array, pat: Uint8Array, from = 0): number {
  const first = pat[0]
  for (let i = data.indexOf(first, from); i >= 0 && i <= data.length - pat.length; i = data.indexOf(first, i + 1)) {
    let j = 1
    while (j < pat.length && data[i + j] === pat[j]) j++
    if (j === pat.length) return i
  }
  return -1
}

export function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
