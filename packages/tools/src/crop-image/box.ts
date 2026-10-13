/** the area to keep as fractions (0..1) of the image, so it doesn't depend on the image's pixel size */
export type CropOptions = { x: number; y: number; w: number; h: number }

/** the pixel box for a fractional selection; the preview and the engine both use this so they always agree */
export function cropBox(o: CropOptions, width: number, height: number) {
  const x = Math.min(width - 1, Math.max(0, Math.round(o.x * width)))
  const y = Math.min(height - 1, Math.max(0, Math.round(o.y * height)))
  return {
    x,
    y,
    w: Math.min(width, Math.round((o.x + o.w) * width)) - x,
    h: Math.min(height, Math.round((o.y + o.h) * height)) - y,
  }
}
