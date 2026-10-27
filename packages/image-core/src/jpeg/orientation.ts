/** where the orientation tag (0x0112) keeps its value in a TIFF block (the part of an EXIF segment after "Exif\0\0"), as [offset, little-endian], or null */
function orientationSlot(b: Uint8Array, tiff: number, end: number): [number, boolean] | null {
  if (tiff + 8 > end || (b[tiff] !== 0x49 && b[tiff] !== 0x4d)) return null
  const le = b[tiff] === 0x49
  const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1])
  const u32 = (o: number) => (le ? (u16(o) | (u16(o + 2) << 16)) >>> 0 : ((u16(o) << 16) | u16(o + 2)) >>> 0)
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > end) return null
  const count = u16(ifd)
  for (let k = 0; k < count && ifd + 2 + k * 12 + 12 <= end; k++) {
    const e = ifd + 2 + k * 12
    if (u16(e) === 0x0112) return [e + 8, le]
  }
  return null
}

/** the orientation 1..8 of a TIFF block, or 1 when absent or unreadable */
export function tiffOrientation(b: Uint8Array, tiff: number, end: number): number {
  const slot = orientationSlot(b, tiff, end)
  if (!slot) return 1
  const [at, le] = slot
  const v = le ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1]
  return v >= 1 && v <= 8 ? v : 1
}

/** a copy of a complete EXIF segment (marker and length included) with its orientation set to `value`; unchanged when it has none */
export function withOrientation(segment: Uint8Array, value: number): Uint8Array {
  const out = segment.slice()
  const slot = orientationSlot(out, 10, out.length) // 2 marker + 2 length + 6 for "Exif\0\0"
  if (slot) {
    const [at, le] = slot
    out[at] = le ? value : 0
    out[at + 1] = le ? 0 : value
  }
  return out
}
