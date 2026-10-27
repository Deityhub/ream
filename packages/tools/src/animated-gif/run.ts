import { UserError, type FileData, type RunFn } from '@ream/core'
import { createImage, crop, encodeGif, resize, type ImageBuffer } from '@ream/image-core'
import { decodeFile } from '../image-common.ts'
import { MAX_SIDE, type AnimatedGifOptions } from './options.ts'

export type { AnimatedGifOptions }

const MAX_FRAMES = 300
// every frame is held as full-colour pixels while the animation is built
const MAX_PIXELS = 160_000_000

const BACKGROUND = { white: [255, 255, 255, 255], black: [0, 0, 0, 255], transparent: [0, 0, 0, 0] }

/** one picture made into a w x h frame the way `fit` says */
function frame(img: ImageBuffer, w: number, h: number, fit: AnimatedGifOptions['fit'], background: AnimatedGifOptions['background']): ImageBuffer {
  if (img.width === w && img.height === h) return img
  if (fit === 'stretch') return resize(img, w, h)
  const scale = fit === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height)
  // rounding must not leave a covering picture a pixel short
  const sw = fit === 'cover' ? Math.max(w, Math.round(img.width * scale)) : Math.max(1, Math.min(w, Math.round(img.width * scale)))
  const sh = fit === 'cover' ? Math.max(h, Math.round(img.height * scale)) : Math.max(1, Math.min(h, Math.round(img.height * scale)))
  const scaled = sw === img.width && sh === img.height ? img : resize(img, sw, sh)
  if (fit === 'cover') return crop(scaled, (sw - w) >> 1, (sh - h) >> 1, w, h)
  const out = createImage(w, h)
  const bg = BACKGROUND[background]
  for (let i = 0; i < out.data.length; i += 4) out.data.set(bg, i)
  const ox = (w - sw) >> 1
  const oy = (h - sh) >> 1
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = (y * sw + x) * 4
      const d = ((oy + y) * w + ox + x) * 4
      const a = scaled.data[s + 3] / 255
      if (background === 'transparent' || a === 1) out.data.set(scaled.data.subarray(s, s + 4), d)
      else for (let c = 0; c < 3; c++) out.data[d + c] = scaled.data[s + c] * a + bg[c] * (1 - a)
    }
  }
  return out
}

export const run: RunFn<AnimatedGifOptions> = async (files, o, { progress }) => {
  if (files.length < 2) throw new UserError('Add at least two images to make an animation.')
  if (files.length > MAX_FRAMES) throw new UserError(`An animation can have at most ${MAX_FRAMES} pictures.`)
  if (!(o.delay >= 20)) throw new UserError('Each picture has to stay for at least 20 milliseconds.')
  const pictures: ImageBuffer[] = []
  for (const [i, f] of files.entries()) {
    pictures.push(await decodeFile(f))
    progress(((i + 1) / files.length) * 0.5)
  }
  // the animation is as big as the first picture (or as wide as asked), in the first picture's shape
  const first = pictures[0]
  let w = o.width > 0 ? o.width : first.width
  let h = Math.max(1, Math.round((w * first.height) / first.width))
  const longest = Math.max(w, h)
  if (o.width === 0 && longest > MAX_SIDE) {
    w = Math.max(1, Math.round((w * MAX_SIDE) / longest))
    h = Math.max(1, Math.round((h * MAX_SIDE) / longest))
  }
  const count = o.pingPong ? files.length * 2 - 2 : files.length
  if (w * h * count > MAX_PIXELS) throw new UserError('This animation would be too big to build here. Choose a smaller width or fewer pictures.')
  const frames = pictures.map((p) => ({ image: frame(p, w, h, o.fit, o.background), delay: o.delay }))
  // forward then back, without showing the first and last picture twice
  const sequence = o.pingPong ? [...frames, ...frames.slice(1, -1).reverse()] : frames
  progress(0.7)
  const bytes = encodeGif(sequence, { loops: o.loop === 'forever' ? 0 : -1, colors: o.colors, dither: o.dither })
  progress(1)
  return [{ name: 'animation.gif', type: 'image/gif', bytes } satisfies FileData]
}
