// 8x8 discrete cosine transforms as two passes of a plain 8-point matrix product. Not the fastest way (libjpeg uses
// fixed-point butterflies), but exact in floating point and short enough to check by eye.
// ponytail: about 1000 multiplications per block; a butterfly (AAN/Loeffler) version is ~3x faster if decode time matters.

// C[x * 8 + u] = c(u) / 2 * cos((2x + 1) u PI / 16), with c(0) = 1 / sqrt 2
const C = new Float32Array(64)
for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) C[x * 8 + u] = ((u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)) / 2

const mid = new Float32Array(64)
const blk = new Float32Array(64)
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

/**
 * Coefficients (natural order, quantised) to 8x8 samples. `q` is the quantisation table in natural order. The block is
 * written at `out[at]` with `stride` bytes per row.
 */
export function idct(coef: Int16Array, from: number, q: Int32Array, out: Uint8Array, at: number, stride: number): void {
  let flat = true
  for (let i = 1; i < 64; i++) {
    if (coef[from + i] !== 0) {
      flat = false
      break
    }
  }
  if (flat) {
    // only the average is there (smooth areas): one value for the whole block
    const v = clamp((coef[from] * q[0]) / 8 + 128)
    for (let y = 0; y < 8; y++) out.fill(v, at + y * stride, at + y * stride + 8)
    return
  }
  for (let i = 0; i < 64; i++) blk[i] = coef[from + i] * q[i]
  // rows (horizontal frequencies u to positions x), then columns
  for (let v = 0; v < 8; v++) {
    for (let x = 0; x < 8; x++) {
      let s = 0
      for (let u = 0; u < 8; u++) s += C[x * 8 + u] * blk[v * 8 + u]
      mid[v * 8 + x] = s
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0
      for (let v = 0; v < 8; v++) s += C[y * 8 + v] * mid[v * 8 + x]
      out[at + y * stride + x] = clamp(s + 128)
    }
  }
}

const sample = new Float32Array(64)

/** 8x8 samples (level shifted by 128 here) to coefficients in natural order, not yet quantised */
export function fdct(src: Uint8Array | Float32Array, at: number, stride: number, out: Float32Array): void {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sample[y * 8 + x] = src[at + y * stride + x] - 128
  // rows: positions x to frequencies u
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0
      for (let x = 0; x < 8; x++) s += C[x * 8 + u] * sample[y * 8 + x]
      mid[y * 8 + u] = s
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0
      for (let y = 0; y < 8; y++) s += C[y * 8 + v] * mid[y * 8 + u]
      out[v * 8 + u] = s
    }
  }
}
