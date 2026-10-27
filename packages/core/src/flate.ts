// Platform seam: browsers and Node 22 both ship these streams. A React Native build swaps in its own.
async function pipe(data: Uint8Array, t: DecompressionStream | CompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(t as ReadableWritablePair<Uint8Array, BufferSource>))
  return new Uint8Array(await out.arrayBuffer())
}

/**
 * zlib inflate. Bytes after the end of the compressed data (a line break counted in a PDF stream's Length is common)
 * make the platform's stream fail after it has given everything: that output is kept, as PDF readers do.
 */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate') as ReadableWritablePair<Uint8Array, BufferSource>).getReader()
  const chunks: Uint8Array[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
  } catch (e) {
    if (!chunks.length) throw e
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  chunks.reduce((at, c) => (out.set(c, at), at + c.length), 0)
  return out
}
export const deflate = (data: Uint8Array) => pipe(data, new CompressionStream('deflate'))
/** raw deflate (no zlib header), the form inside ZIP archives */
export const deflateRaw = (data: Uint8Array) => pipe(data, new CompressionStream('deflate-raw'))

/** Raw inflate that gives up past `max` bytes, so a small hostile archive entry can't fill memory. Returns null when over. */
export async function inflateRaw(data: Uint8Array, max: number): Promise<Uint8Array | null> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw') as ReadableWritablePair<Uint8Array, BufferSource>).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** undo PNG row filters: PDF /Predictor 10-15 and PNG scanlines share the format */
export function pngPredictor(data: Uint8Array, columns: number, colors = 1, bpc = 8): Uint8Array {
  const bpp = Math.max(1, (colors * bpc + 7) >> 3)
  const row = (colors * bpc * columns + 7) >> 3
  const rows = Math.floor(data.length / (row + 1))
  const out = new Uint8Array(rows * row)
  // one loop per filter type: deciding per byte was most of the cost of reading a big PNG or a predicted PDF stream
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (row + 1)]
    const src = r * (row + 1) + 1
    const dst = r * row
    const up = dst - row // the row above, when there is one (r > 0)
    if (ft === 1) {
      for (let i = 0; i < row; i++) out[dst + i] = data[src + i] + (i >= bpp ? out[dst + i - bpp] : 0)
    } else if (ft === 2 && r > 0) {
      for (let i = 0; i < row; i++) out[dst + i] = data[src + i] + out[up + i]
    } else if (ft === 3) {
      for (let i = 0; i < row; i++) out[dst + i] = data[src + i] + (((i >= bpp ? out[dst + i - bpp] : 0) + (r > 0 ? out[up + i] : 0)) >> 1)
    } else if (ft === 4 && r === 0) {
      // Paeth with nothing above always picks the left neighbour (Sub)
      for (let i = 0; i < row; i++) out[dst + i] = data[src + i] + (i >= bpp ? out[dst + i - bpp] : 0)
    } else if (ft === 4) {
      // with nothing to the left it picks the byte above (Up)
      for (let i = 0; i < bpp && i < row; i++) out[dst + i] = data[src + i] + out[up + i]
      for (let i = bpp; i < row; i++) {
        const a = out[dst + i - bpp]
        const b = out[up + i]
        const c = out[up + i - bpp]
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        out[dst + i] = data[src + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
    } else {
      // none, "up" on the first row, and unknown types: the bytes as they are
      out.set(data.subarray(src, src + row), dst)
    }
  }
  return out
}
