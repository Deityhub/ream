// Walking the marker segments of a JPEG, to find, keep or drop the metadata in them without touching the picture data.

export type JpegKind = 'exif' | 'xmp' | 'iptc' | 'icc' | 'comment' | 'jfif' | 'adobe' | 'other'

export type JpegSegment = {
  marker: number
  kind: JpegKind
  /** the whole segment: marker, length and payload */
  bytes: Uint8Array
}

const starts = (b: Uint8Array, at: number, text: string) => text.split('').every((c, i) => b[at + i] === c.charCodeAt(0))

function kindOf(marker: number, b: Uint8Array, payload: number): JpegKind {
  if (marker === 0xfe) return 'comment'
  if (marker === 0xe0 && starts(b, payload, 'JFIF\0')) return 'jfif'
  if (marker === 0xe1 && starts(b, payload, 'Exif\0\0')) return 'exif'
  if (marker === 0xe1 && starts(b, payload, 'http://ns.adobe.com/xap/1.0/\0')) return 'xmp'
  if (marker === 0xe2 && starts(b, payload, 'ICC_PROFILE\0')) return 'icc'
  if (marker === 0xed && starts(b, payload, 'Photoshop 3.0\0')) return 'iptc'
  if (marker === 0xee && starts(b, payload, 'Adobe')) return 'adobe'
  return 'other'
}

/** the segments before the scan, and the offset where the rest of the file (tables, scan data) starts */
export function readSegments(b: Uint8Array): { segments: JpegSegment[]; rest: number } {
  const segments: JpegSegment[] = []
  let i = 2
  while (i + 3 < b.length && b[i] === 0xff) {
    const m = b[i + 1]
    if (m === 0xff) {
      i++
      continue
    }
    // only the application segments and comments are metadata; everything from the first table or frame on is "the rest"
    if (!(m === 0xfe || (m >= 0xe0 && m <= 0xef))) break
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len < 2 || i + 2 + len > b.length) break
    segments.push({ marker: m, kind: kindOf(m, b, i + 4), bytes: b.subarray(i, i + 2 + len) })
    i += 2 + len
  }
  return { segments, rest: i }
}

/** the JPEG with each metadata segment kept (return it), replaced (return new bytes) or dropped (return null) */
export function rewriteSegments(b: Uint8Array, decide: (s: JpegSegment) => Uint8Array | null): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b
  const { segments, rest } = readSegments(b)
  const parts: Uint8Array[] = [b.subarray(0, 2)]
  for (const s of segments) {
    const out = decide(s)
    if (out) parts.push(out)
  }
  parts.push(b.subarray(rest))
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  return out
}
