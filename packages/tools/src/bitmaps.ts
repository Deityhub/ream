// Making pictures from text and files with the browser canvas, for tools that lay a picture over another (signature,
// watermark, captions). The engines only ever see the PNG that comes out, so they stay free of fonts and DOM types.

/** the canvas as PNG bytes; null if the browser can't encode it */
export async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

/** the canvas cut down to the box around what is drawn on it (plus `pad` pixels each side), as a PNG; null when nothing is drawn */
export async function trimmedPng(canvas: HTMLCanvasElement, pad: number): Promise<Uint8Array | null> {
  const { width, height } = canvas
  const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data
  let [x0, y0, x1, y1] = [width, height, -1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1 + 2 * pad
  out.height = y1 - y0 + 1 + 2 * pad
  out.getContext('2d')!.drawImage(canvas, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1)
  return canvasPng(out)
}

/** the canvas turned by `degrees` clockwise on a canvas just big enough to hold it */
export function rotatedCanvas(src: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  if (!degrees) return src
  const a = (degrees * Math.PI) / 180
  const c = document.createElement('canvas')
  c.width = Math.ceil(Math.abs(src.width * Math.cos(a)) + Math.abs(src.height * Math.sin(a)))
  c.height = Math.ceil(Math.abs(src.width * Math.sin(a)) + Math.abs(src.height * Math.cos(a)))
  const g = c.getContext('2d')!
  g.translate(c.width / 2, c.height / 2)
  g.rotate(a)
  g.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

export type TextStyle = { family: string; bold: boolean; italic: boolean; colour: string }
const font = (s: TextStyle, px: number) => `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${px}px ${s.family}`

/** a line of text as a transparent PNG, turned by `angle` degrees; null for blank text */
export async function textMark(text: string, s: TextStyle, angle: number): Promise<Uint8Array | null> {
  if (!text.trim()) return null
  const px = 240 // big, so scaling it down stays sharp
  await document.fonts.load(font(s, px)).catch(() => [])
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  g.font = font(s, px)
  c.width = Math.ceil(g.measureText(text).width) + px
  c.height = Math.ceil(px * 1.6)
  g.font = font(s, px)
  g.fillStyle = s.colour
  g.textBaseline = 'middle'
  g.fillText(text, px / 2, c.height / 2)
  return trimmedPng(rotatedCanvas(c, angle), 4)
}

/** a picture file as a PNG no bigger than `maxSide`, turned by `angle` degrees; null if the browser can't read it */
export async function pictureMark(file: Blob, angle: number, maxSide = 1200): Promise<Uint8Array | null> {
  const bmp = await createImageBitmap(file).catch(() => null)
  if (!bmp) return null
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * k))
  c.height = Math.max(1, Math.round(bmp.height * k))
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return trimmedPng(rotatedCanvas(c, angle), 0)
}
