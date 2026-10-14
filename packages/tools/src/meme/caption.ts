// Drawing a caption in the browser: wide white letters with a black outline, wrapped to the picture's width.
import '@fontsource/anton/400.css'
import { canvasPng } from '../bitmaps.ts'

const FONT = 'Anton'
const MAX_LINES = 4

/** the caption as a transparent PNG `width` pixels wide, or null for blank text. `sizePct` is the letter height as a share of `width`. */
export async function captionPng(text: string, width: number, sizePct: number, colour: string): Promise<Uint8Array | null> {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  await document.fonts.load(`100px ${FONT}`).catch(() => [])
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  const room = width * 0.94
  let px = Math.max(8, (width * sizePct) / 100)
  let lines: string[] = []
  for (;;) {
    g.font = `${px}px ${FONT}`
    lines = []
    let line = ''
    for (const w of words) {
      const next = line ? `${line} ${w}` : w
      if (line && g.measureText(next).width > room) {
        lines.push(line)
        line = w
      } else line = next
    }
    lines.push(line)
    // smaller letters until the longest word fits across and there are few enough lines
    if ((lines.every((l) => g.measureText(l).width <= room) && lines.length <= MAX_LINES) || px <= 8) break
    px *= 0.92
  }
  const lead = px * 1.12
  c.width = width
  c.height = Math.ceil(lines.length * lead + px * 0.3)
  g.font = `${px}px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'alphabetic'
  g.lineJoin = 'round'
  g.lineWidth = px * 0.16
  g.strokeStyle = '#000'
  g.fillStyle = colour
  lines.forEach((l, i) => {
    const y = px * 0.15 + (i + 0.85) * lead
    g.strokeText(l, width / 2, y)
    g.fillText(l, width / 2, y)
  })
  return canvasPng(c)
}
