// Constants only, shared by the panel and the run.
export type AnimatedGifOptions = {
  /** how long each picture stays, in milliseconds */
  delay: number
  loop: 'forever' | 'once'
  /** width of the animation in pixels; 0 uses the first picture's size */
  width: number
  /** contain: whole picture with bars if the shape differs; cover: fills the frame, cropping; stretch: squeezed to fit */
  fit: 'contain' | 'cover' | 'stretch'
  /** what shows in the bars (and in transparent parts) */
  background: 'white' | 'black' | 'transparent'
  /** play forward, then back */
  pingPong: boolean
  colors: number
  dither: boolean
}

export const WIDTHS = [0, 1024, 800, 640, 480, 320, 240]
export const COLOR_STEPS = [256, 128, 64, 32]
/** the longest side the animation is allowed to have when it takes the first picture's size */
export const MAX_SIDE = 2000

export const defaultOptions: AnimatedGifOptions = { delay: 500, loop: 'forever', width: 0, fit: 'contain', background: 'white', pingPong: false, colors: 256, dither: true }
