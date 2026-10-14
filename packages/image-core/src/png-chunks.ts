// The chunk list of a PNG, to keep or drop metadata without decoding the picture.
export type PngChunk = {
  type: string
  /** the whole chunk: length, type, data and checksum */
  bytes: Uint8Array
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/** every chunk in order, or null when this is not a PNG */
export function readChunks(b: Uint8Array): PngChunk[] | null {
  if (b.length < 8 || SIGNATURE.some((v, i) => b[i] !== v)) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: PngChunk[] = []
  for (let at = 8; at + 12 <= b.length; ) {
    const len = v.getUint32(at)
    if (at + 12 + len > b.length) break
    out.push({ type: String.fromCharCode(...b.subarray(at + 4, at + 8)), bytes: b.subarray(at, at + 12 + len) })
    at += 12 + len
  }
  return out
}

/** the chunks that say how to read the colours (profile, sRGB, gamma, primaries) and the pixel density */
export const COLOUR_CHUNKS = ['iCCP', 'sRGB', 'gAMA', 'cHRM', 'pHYs']

export function colourChunks(b: Uint8Array): Uint8Array[] {
  return (readChunks(b) ?? []).filter((c) => COLOUR_CHUNKS.includes(c.type)).map((c) => c.bytes)
}
