// Cutting a picture down to a palette of at most 256 colours: median cut for the palette, then the nearest colour for
// each pixel, optionally with Floyd-Steinberg error diffusion. Used for "fewer colours" PNGs and for GIF frames.
import { createImage, type ImageBuffer } from './buffer.ts'

// colours are counted in bins of 5 bits per colour channel and 4 bits of alpha
const key = (r: number, g: number, b: number, a: number) => ((r >> 3) << 14) | ((g >> 3) << 9) | ((b >> 3) << 4) | (a >> 4)
const BINS = 1 << 19
// how much a difference in each channel matters to the eye (roughly luminance weights, a little flattened)
const W = [0.9, 1.2, 0.6, 1]

type Box = { bins: number[]; count: number }

/**
 * A palette for the picture: `colors` entries of r, g, b, a (at most 256). Pixels with an alpha below `alphaCut` are
 * left out when `alphaCut` is given (GIF has only on and off transparency).
 */
export function buildPalette(img: ImageBuffer, maxColors: number, alphaCut = 0): Uint8Array {
  const count = new Float64Array(BINS)
  const sum = new Float64Array(BINS * 4)
  const used: number[] = []
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (alphaCut && d[i + 3] < alphaCut) continue
    const k = key(d[i], d[i + 1], d[i + 2], alphaCut ? 255 : d[i + 3])
    if (count[k] === 0) used.push(k)
    count[k]++
    sum[k * 4] += d[i]
    sum[k * 4 + 1] += d[i + 1]
    sum[k * 4 + 2] += d[i + 2]
    sum[k * 4 + 3] += alphaCut ? 255 : d[i + 3]
  }
  if (!used.length) return Uint8Array.of(0, 0, 0, 255)
  const mean = (k: number, c: number) => sum[k * 4 + c] / count[k]
  const boxes: Box[] = [{ bins: used, count: used.reduce((n, k) => n + count[k], 0) }]
  const range = (b: Box) => {
    const lo = [255, 255, 255, 255]
    const hi = [0, 0, 0, 0]
    for (const k of b.bins) {
      for (let c = 0; c < 4; c++) {
        const v = mean(k, c)
        if (v < lo[c]) lo[c] = v
        if (v > hi[c]) hi[c] = v
      }
    }
    return [0, 1, 2, 3].map((c) => (hi[c] - lo[c]) * W[c])
  }
  while (boxes.length < maxColors) {
    // split the box that holds the most pixels, unless it is a single colour
    let at = -1
    for (let i = 0; i < boxes.length; i++) if (boxes[i].bins.length > 1 && (at < 0 || boxes[i].count > boxes[at].count)) at = i
    if (at < 0) break
    const box = boxes[at]
    const r = range(box)
    const ch = r.indexOf(Math.max(...r))
    const sorted = box.bins.slice().sort((p, q) => mean(p, ch) - mean(q, ch))
    let acc = 0
    let cut = 0
    while (cut < sorted.length - 1 && acc + count[sorted[cut]] < box.count / 2) acc += count[sorted[cut++]]
    cut = Math.max(1, cut) // both halves keep at least one colour
    const a = sorted.slice(0, cut)
    const b = sorted.slice(cut)
    const ca = a.reduce((n, k) => n + count[k], 0)
    boxes.splice(at, 1, { bins: a, count: ca }, { bins: b, count: box.count - ca })
  }
  const out = new Uint8Array(boxes.length * 4)
  boxes.forEach((box, i) => {
    for (let c = 0; c < 4; c++) {
      let s = 0
      for (const k of box.bins) s += sum[k * 4 + c]
      out[i * 4 + c] = Math.round(s / box.count)
    }
  })
  return out
}

/**
 * The palette index of every pixel. `palette` holds r, g, b, a per entry. With `dither` the rounding error of each pixel is
 * passed on to its neighbours, which trades banding for fine noise. `transparent`, when given, is the index used for
 * pixels with alpha below 128 (they are not part of the palette search).
 */
export function mapToPalette(img: ImageBuffer, palette: Uint8Array, dither: boolean, transparent = -1): Uint8Array {
  const { width: w, height: h, data: d } = img
  const n = palette.length / 4
  const out = new Uint8Array(w * h)
  const cache = new Int16Array(BINS).fill(-1)
  const useAlpha = transparent < 0
  const nearest = (r: number, g: number, b: number, a: number) => {
    const k = key(r, g, b, a)
    if (cache[k] >= 0) return cache[k]
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      if (i === transparent) continue
      const dr = (palette[i * 4] - r) * W[0]
      const dg = (palette[i * 4 + 1] - g) * W[1]
      const db = (palette[i * 4 + 2] - b) * W[2]
      const da = useAlpha ? (palette[i * 4 + 3] - a) * W[3] : 0
      const dist = dr * dr + dg * dg + db * db + da * da
      if (dist < bestD) {
        bestD = dist
        best = i
      }
    }
    return (cache[k] = best)
  }
  const c = [0, 0, 0, 0]
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
  // error rows for Floyd-Steinberg: this row and the next, 4 channels per pixel
  let cur = new Float32Array((w + 2) * 4)
  let next = new Float32Array((w + 2) * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (transparent >= 0 && d[i + 3] < 128) {
        out[y * w + x] = transparent
        continue
      }
      const e = (x + 1) * 4
      // the pixel with the error handed down to it, kept inside 0..255
      c[0] = clamp(d[i] + (dither ? cur[e] : 0))
      c[1] = clamp(d[i + 1] + (dither ? cur[e + 1] : 0))
      c[2] = clamp(d[i + 2] + (dither ? cur[e + 2] : 0))
      c[3] = clamp(d[i + 3] + (dither ? cur[e + 3] : 0))
      const idx = nearest(c[0], c[1], c[2], useAlpha ? c[3] : 255)
      out[y * w + x] = idx
      if (dither) {
        for (let k = 0; k < (useAlpha ? 4 : 3); k++) {
          const err = c[k] - palette[idx * 4 + k]
          cur[e + 4 + k] += (err * 7) / 16
          next[e - 4 + k] += (err * 3) / 16
          next[e + k] += (err * 5) / 16
          next[e + 4 + k] += err / 16
        }
      }
    }
    ;[cur, next] = [next, cur]
    next.fill(0)
  }
  return out
}

/** the picture redrawn with at most `colors` distinct colours (alpha included), ready for a palette PNG */
export function quantize(img: ImageBuffer, colors: number, dither = true): ImageBuffer {
  const palette = buildPalette(img, Math.min(256, Math.max(2, colors)))
  const index = mapToPalette(img, palette, dither)
  const out = createImage(img.width, img.height)
  for (let i = 0; i < index.length; i++) out.data.set(palette.subarray(index[i] * 4, index[i] * 4 + 4), i * 4)
  return out
}
