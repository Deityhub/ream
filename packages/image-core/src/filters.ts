// Pixel filters: blur, pixelate, solid fill, colour adjustments, sharpen. All change the buffer in place.
import type { ImageBuffer } from './buffer.ts'

/** an area in whole pixels */
export type Area = { x: number; y: number; w: number; h: number }

/** the area clipped to the picture, or null when nothing of it is inside */
function within(img: ImageBuffer, a?: Area): Area | null {
  const x = Math.max(0, Math.floor(a?.x ?? 0))
  const y = Math.max(0, Math.floor(a?.y ?? 0))
  const w = Math.min(img.width, Math.ceil((a?.x ?? 0) + (a?.w ?? img.width))) - x
  const h = Math.min(img.height, Math.ceil((a?.y ?? 0) + (a?.h ?? img.height))) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

// ---------- blur: three box passes per direction, close to a Gaussian of the same radius ----------

/** one box pass along a line of `n` pixels starting at `start`, `step` apart in the data; edges repeat their last pixel */
function boxLine(d: Uint8ClampedArray, start: number, step: number, n: number, r: number, line: Float32Array) {
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < n; i++) line[i] = d[start + i * step + c]
    let sum = 0
    for (let k = -r; k <= r; k++) sum += line[Math.min(n - 1, Math.max(0, k))]
    for (let i = 0; i < n; i++) {
      d[start + i * step + c] = sum / (2 * r + 1)
      sum += line[Math.min(n - 1, i + r + 1)] - line[Math.max(0, i - r)]
    }
  }
}

/** Blur `area` (default the whole picture) by `radius` pixels. Only pixels inside the area are used, so nothing outside leaks in. */
export function blur(img: ImageBuffer, radius: number, area?: Area): void {
  const a = within(img, area)
  const r = Math.round(radius)
  if (!a || r < 1) return
  const d = img.data
  const row = img.width * 4
  const at = (x: number, y: number) => (y * img.width + x) * 4
  // colour is averaged weighted by alpha, so see-through pixels (often black underneath) don't darken their neighbours
  let translucent = false
  for (let y = a.y; y < a.y + a.h && !translucent; y++) for (let x = a.x; x < a.x + a.w; x++) if (d[at(x, y) + 3] < 255) { translucent = true; break }
  if (translucent) {
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = at(x, y)
      const k = d[i + 3] / 255
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k
    }
  }
  const line = new Float32Array(Math.max(a.w, a.h))
  for (let pass = 0; pass < 3; pass++) {
    for (let y = a.y; y < a.y + a.h; y++) boxLine(d, at(a.x, y), 4, a.w, r, line)
    for (let x = a.x; x < a.x + a.w; x++) boxLine(d, at(x, a.y), row, a.h, r, line)
  }
  if (translucent) {
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const i = at(x, y)
      const k = d[i + 3] / 255
      if (k > 0) { d[i] /= k; d[i + 1] /= k; d[i + 2] /= k }
    }
  }
}

/** Replace `area` with blocks of their average colour, `block` pixels square, counted from the area's top-left corner. */
export function pixelate(img: ImageBuffer, block: number, area?: Area): void {
  const a = within(img, area)
  const b = Math.max(1, Math.round(block))
  if (!a) return
  const d = img.data
  for (let by = a.y; by < a.y + a.h; by += b) {
    for (let bx = a.x; bx < a.x + a.w; bx += b) {
      const x1 = Math.min(a.x + a.w, bx + b)
      const y1 = Math.min(a.y + a.h, by + b)
      let r = 0, g = 0, bl = 0, al = 0
      for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++) {
        const i = (y * img.width + x) * 4
        const k = d[i + 3]
        r += d[i] * k; g += d[i + 1] * k; bl += d[i + 2] * k; al += k
      }
      const n = (x1 - bx) * (y1 - by)
      const avg = [al ? r / al : 0, al ? g / al : 0, al ? bl / al : 0, al / n]
      for (let y = by; y < y1; y++) for (let x = bx; x < x1; x++) d.set(avg, (y * img.width + x) * 4)
    }
  }
}

/** Paint `area` with one opaque colour: the original pixels are gone, unlike a blur which can sometimes be undone. */
export function fill(img: ImageBuffer, rgb: [number, number, number], area?: Area): void {
  const a = within(img, area)
  if (!a) return
  for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) img.data.set([rgb[0], rgb[1], rgb[2], 255], (y * img.width + x) * 4)
}

// ---------- colour ----------

export type Adjustments = {
  /** each -100..100; 0 changes nothing */
  brightness: number
  contrast: number
  saturation: number
  /** positive pushes towards orange, negative towards blue */
  warmth: number
  /** 0..100: how far towards a brown tone */
  sepia: number
  /** 0..100: darkening towards the corners */
  vignette: number
}

export const NO_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sepia: 0, vignette: 0 }

/** Brightness, contrast, saturation, warmth, sepia and vignette in one pass. Alpha is left alone. */
export function adjust(img: ImageBuffer, p: Adjustments): void {
  const bright = 1 + p.brightness / 100
  const contrast = 1 + p.contrast / 100
  const sat = 1 + p.saturation / 100
  const warm = p.warmth / 100
  const sepia = p.sepia / 100
  const vig = p.vignette / 100
  const { width, height, data: d } = img
  const cx = (width - 1) / 2
  const cy = (height - 1) / 2
  const reach = Math.hypot(cx, cy) || 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      let r = d[i] * (1 + 0.25 * warm)
      let g = d[i + 1]
      let b = d[i + 2] * (1 - 0.25 * warm)
      r = (r * bright - 128) * contrast + 128
      g = (g * bright - 128) * contrast + 128
      b = (b * bright - 128) * contrast + 128
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = l + (r - l) * sat
      g = l + (g - l) * sat
      b = l + (b - l) * sat
      if (sepia) {
        // the same matrix browsers use for their sepia filter
        const sr = 0.393 * r + 0.769 * g + 0.189 * b
        const sg = 0.349 * r + 0.686 * g + 0.168 * b
        const sb = 0.272 * r + 0.534 * g + 0.131 * b
        r += (sr - r) * sepia
        g += (sg - g) * sepia
        b += (sb - b) * sepia
      }
      if (vig) {
        const t = Math.min(1, Math.max(0, (Math.hypot(x - cx, y - cy) / reach - 0.35) / 0.65))
        const k = 1 - vig * 0.85 * t * t * (3 - 2 * t)
        r *= k; g *= k; b *= k
      }
      d[i] = r // the clamped array rounds and limits to 0..255
      d[i + 1] = g
      d[i + 2] = b
    }
  }
}

/** Unsharp mask: add back `amount` times what a blur of `radius` takes away. Alpha is left alone. */
export function sharpen(img: ImageBuffer, amount: number, radius: number): void {
  if (amount <= 0) return
  const soft: ImageBuffer = { width: img.width, height: img.height, data: img.data.slice() }
  blur(soft, radius)
  const d = img.data
  const s = soft.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] += (d[i] - s[i]) * amount
    d[i + 1] += (d[i + 1] - s[i + 1]) * amount
    d[i + 2] += (d[i + 2] - s[i + 2]) * amount
  }
}
