import { UserError } from '@ream/core'
import { checkPixels, createImage, type ImageBuffer } from './buffer.ts'

const copy = (img: ImageBuffer): ImageBuffer => ({ width: img.width, height: img.height, data: img.data.slice() })

// ---------- resize: separable Lanczos-3, alpha-weighted so transparent edges don't darken ----------

function lanczos(x: number): number {
  x = Math.abs(x)
  if (x >= 3) return 0
  if (x < 1e-8) return 1
  const px = Math.PI * x
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px)
}

/** for each output index: first source index, tap count, and normalised weights (stride maxTaps) */
function axisWeights(src: number, dst: number) {
  const scale = src / dst
  const fs = Math.max(scale, 1) // widen the kernel when shrinking so every source pixel contributes
  const support = 3 * fs
  const maxTaps = Math.ceil(support * 2) + 2
  const starts = new Int32Array(dst)
  const counts = new Int32Array(dst)
  const weights = new Float32Array(dst * maxTaps)
  for (let i = 0; i < dst; i++) {
    const center = (i + 0.5) * scale
    const start = Math.max(0, Math.floor(center - support))
    const end = Math.min(src, Math.ceil(center + support))
    let sum = 0
    for (let j = start; j < end; j++) {
      const w = lanczos((j + 0.5 - center) / fs)
      weights[i * maxTaps + j - start] = w
      sum += w
    }
    if (sum !== 0) for (let j = start; j < end; j++) weights[i * maxTaps + j - start] /= sum
    starts[i] = start
    counts[i] = end - start
  }
  return { starts, counts, weights, maxTaps }
}

export function resize(img: ImageBuffer, width: number, height: number): ImageBuffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new UserError('The new size must be at least 1 pixel in each direction.')
  }
  checkPixels(width, height, 'The resized image would be')
  if (width === img.width && height === img.height) return copy(img)

  const { width: sw, height: sh, data: src } = img
  // pass 1 (horizontal) into premultiplied floats: rgb holds r*a/255, alpha holds a
  const hx = axisWeights(sw, width)
  const tmp = new Float32Array(width * sh * 4)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < width; x++) {
      const base = x * hx.maxTaps
      let r = 0, g = 0, b = 0, a = 0
      for (let k = 0; k < hx.counts[x]; k++) {
        const wt = hx.weights[base + k]
        const p = (y * sw + hx.starts[x] + k) * 4
        const pa = src[p + 3]
        const f = (wt * pa) / 255
        r += src[p] * f
        g += src[p + 1] * f
        b += src[p + 2] * f
        a += wt * pa
      }
      const o = (y * width + x) * 4
      tmp[o] = r
      tmp[o + 1] = g
      tmp[o + 2] = b
      tmp[o + 3] = a
    }
  }
  // pass 2 (vertical), then un-premultiply into the result
  const vy = axisWeights(sh, height)
  const out = createImage(width, height)
  for (let y = 0; y < height; y++) {
    const base = y * vy.maxTaps
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let k = 0; k < vy.counts[y]; k++) {
        const wt = vy.weights[base + k]
        const p = ((vy.starts[y] + k) * width + x) * 4
        r += tmp[p] * wt
        g += tmp[p + 1] * wt
        b += tmp[p + 2] * wt
        a += tmp[p + 3] * wt
      }
      a = Math.min(255, Math.max(0, a))
      const o = (y * width + x) * 4
      if (a > 0.001) {
        const u = 255 / a
        out.data[o] = r * u
        out.data[o + 1] = g * u
        out.data[o + 2] = b * u
      }
      out.data[o + 3] = a
    }
  }
  return out
}

// ---------- crop / rotate / flip ----------

export function crop(img: ImageBuffer, x: number, y: number, width: number, height: number): ImageBuffer {
  if (![x, y, width, height].every(Number.isInteger) || width < 1 || height < 1 || x < 0 || y < 0 || x + width > img.width || y + height > img.height) {
    throw new UserError(`That crop area doesn't fit inside the ${img.width} × ${img.height} image.`)
  }
  const out = createImage(width, height)
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * img.width + x) * 4
    out.data.set(img.data.subarray(from, from + width * 4), row * width * 4)
  }
  return out
}

/** clockwise quarter turns (1 = 90°, 2 = 180°, 3 = 270°) */
export function rotate(img: ImageBuffer, turns: number): ImageBuffer {
  const t = ((turns % 4) + 4) % 4
  if (t === 0) return copy(img)
  const { width: w, height: h, data } = img
  const out = t === 2 ? createImage(w, h) : createImage(h, w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [dx, dy] = t === 1 ? [h - 1 - y, x] : t === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x]
      const s = (y * w + x) * 4
      const d = (dy * out.width + dx) * 4
      out.data[d] = data[s]
      out.data[d + 1] = data[s + 1]
      out.data[d + 2] = data[s + 2]
      out.data[d + 3] = data[s + 3]
    }
  }
  return out
}

/** the picture as an EXIF orientation (1..8) says it should be shown; 1 gives the same picture back */
export function orient(img: ImageBuffer, orientation: number): ImageBuffer {
  switch (orientation) {
    case 2:
      return flip(img, 'horizontal')
    case 3:
      return rotate(img, 2)
    case 4:
      return flip(img, 'vertical')
    case 5:
      return rotate(flip(img, 'horizontal'), 3)
    case 6:
      return rotate(img, 1)
    case 7:
      return rotate(flip(img, 'horizontal'), 1)
    case 8:
      return rotate(img, 3)
    default:
      return img
  }
}

export function flip(img: ImageBuffer, axis: 'horizontal' | 'vertical'): ImageBuffer {
  const { width: w, height: h, data } = img
  const out = createImage(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const d = (axis === 'horizontal' ? y * w + (w - 1 - x) : (h - 1 - y) * w + x) * 4
      out.data.set(data.subarray(s, s + 4), d)
    }
  }
  return out
}

// ---------- compositing ----------

/** drop transparency onto white, for formats without an alpha channel (JPEG) */
export function flattenOnWhite(img: ImageBuffer): ImageBuffer {
  const out = copy(img)
  for (let i = 0; i < out.data.length; i += 4) {
    const a = out.data[i + 3] / 255
    for (let c = 0; c < 3; c++) out.data[i + c] = out.data[i + c] * a + 255 * (1 - a)
    out.data[i + 3] = 255
  }
  return out
}

/** source-over blend of src onto dst at (ox, oy) */
function blit(dst: ImageBuffer, src: ImageBuffer, ox: number, oy: number) {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4
      const sa = src.data[s + 3]
      if (sa === 0) continue
      const d = ((oy + y) * dst.width + ox + x) * 4
      if (sa === 255) {
        dst.data.set(src.data.subarray(s, s + 4), d)
        continue
      }
      const a = sa / 255
      const b = dst.data[d + 3] / 255
      const oa = a + b * (1 - a)
      for (let c = 0; c < 3; c++) dst.data[d + c] = (src.data[s + c] * a + dst.data[d + c] * b * (1 - a)) / oa
      dst.data[d + 3] = oa * 255
    }
  }
}

export type StitchOptions = {
  direction: 'horizontal' | 'vertical' | 'grid'
  /** grid only */
  columns: number
  /** pixels between images */
  gap: number
  background: 'white' | 'transparent'
}

const scaleTo = (img: ImageBuffer, w: number, h: number) => (img.width === w && img.height === h ? img : resize(img, w, h))

/**
 * Join images into one. Horizontal scales everything to the smallest height, vertical to the smallest width
 * (nothing is enlarged); grid fits each image inside equal cells of the smallest width and height.
 */
export function stitch(images: ImageBuffer[], o: StitchOptions): ImageBuffer {
  if (!images.length) throw new UserError('Add at least one image.')
  const gap = Math.max(0, Math.round(o.gap) || 0)
  const n = images.length
  let placed: { img: ImageBuffer; x: number; y: number }[]
  let width: number
  let height: number
  // sizes and the pixel limit are settled before anything is scaled, so a huge request fails cheaply
  const tooBig = () => checkPixels(width, height, 'The combined image would be')

  if (o.direction === 'horizontal' || o.direction === 'vertical') {
    const horiz = o.direction === 'horizontal'
    const common = Math.min(...images.map((i) => (horiz ? i.height : i.width)))
    const sizes = images.map((i) =>
      horiz
        ? { w: Math.max(1, Math.round((i.width * common) / i.height)), h: common }
        : { w: common, h: Math.max(1, Math.round((i.height * common) / i.width)) },
    )
    const along = sizes.reduce((sum, s) => sum + (horiz ? s.w : s.h), 0) + gap * (n - 1)
    width = horiz ? along : common
    height = horiz ? common : along
    tooBig()
    let at = 0
    placed = images.map((img, k) => {
      const p = { img: scaleTo(img, sizes[k].w, sizes[k].h), x: horiz ? at : 0, y: horiz ? 0 : at }
      at += (horiz ? sizes[k].w : sizes[k].h) + gap
      return p
    })
  } else {
    const cols = Math.min(n, Math.max(1, Math.round(o.columns) || 1))
    const rows = Math.ceil(n / cols)
    const cw = Math.min(...images.map((i) => i.width))
    const ch = Math.min(...images.map((i) => i.height))
    width = cols * cw + gap * (cols - 1)
    height = rows * ch + gap * (rows - 1)
    tooBig()
    placed = images.map((i, k) => {
      const s = Math.min(cw / i.width, ch / i.height)
      const w = Math.max(1, Math.round(i.width * s))
      const h = Math.max(1, Math.round(i.height * s))
      const col = k % cols
      const row = Math.floor(k / cols)
      return { img: scaleTo(i, w, h), x: col * (cw + gap) + Math.floor((cw - w) / 2), y: row * (ch + gap) + Math.floor((ch - h) / 2) }
    })
  }

  const out = createImage(width, height)
  if (o.background === 'white') out.data.fill(255)
  for (const p of placed) blit(out, p.img, p.x, p.y)
  return out
}
