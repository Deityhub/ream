// Platform seam: browser, Electron and Node 22 all ship these streams. A React Native build swaps in its own.
async function pipe(data: Uint8Array, t: DecompressionStream | CompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(t as ReadableWritablePair<Uint8Array, BufferSource>))
  return new Uint8Array(await out.arrayBuffer())
}

export const inflate = (data: Uint8Array) => pipe(data, new DecompressionStream('deflate'))
export const deflate = (data: Uint8Array) => pipe(data, new CompressionStream('deflate'))

/** undo PNG row filters: PDF /Predictor 10-15 and PNG scanlines share the format */
export function pngPredictor(data: Uint8Array, columns: number, colors = 1, bpc = 8): Uint8Array {
  const bpp = Math.max(1, (colors * bpc + 7) >> 3)
  const row = (colors * bpc * columns + 7) >> 3
  const rows = Math.floor(data.length / (row + 1))
  const out = new Uint8Array(rows * row)
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (row + 1)]
    const src = r * (row + 1) + 1
    const dst = r * row
    for (let i = 0; i < row; i++) {
      const x = data[src + i]
      const a = i >= bpp ? out[dst + i - bpp] : 0
      const b = r > 0 ? out[dst - row + i] : 0
      const c = i >= bpp && r > 0 ? out[dst - row + i - bpp] : 0
      let v = x
      if (ft === 1) v = x + a
      else if (ft === 2) v = x + b
      else if (ft === 3) v = x + ((a + b) >> 1)
      else if (ft === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      out[dst + i] = v & 255
    }
  }
  return out
}
