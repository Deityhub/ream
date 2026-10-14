// Constants only, shared by the panel and the run.
export type CompressOptions = {
  /** JPEG and WebP quality, 10 to 95 */
  quality: number
  /** PNG and GIF: redraw with fewer colours, which is where the big savings are */
  reduceColors: boolean
  colors: number
  /** error diffusion when colours are reduced: smoother gradients, but noise that costs bytes */
  dither: boolean
  /** keep the camera details, location and so on of a JPEG (the colour profile is always kept) */
  keepMetadata: boolean
}

export const COLOR_STEPS = [256, 128, 64, 32, 16]

export const defaultOptions: CompressOptions = { quality: 75, reduceColors: false, colors: 128, dither: true, keepMetadata: false }
