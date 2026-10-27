// Constants only (no engine imports), so manifests and option panels can use them without pulling in image-core.
import type { OutputMime } from '@ream/image-core'

/** what the browser decoders can open; HEIC, TIFF and RAW need their own decoders later */
export const IMAGE_ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']

export type Format = { mime: OutputMime; ext: string; label: string }

/** everything a picture can be saved as (Convert image) */
export const FORMATS: Format[] = [
  { mime: 'image/png', ext: 'png', label: 'PNG' },
  { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' },
  { mime: 'image/webp', ext: 'webp', label: 'WebP' },
  { mime: 'image/gif', ext: 'gif', label: 'GIF' },
  { mime: 'image/bmp', ext: 'bmp', label: 'BMP' },
]

/** formats a tool that keeps the input's format saves in; GIF (a flat copy of the first frame) and BMP inputs become PNG */
const KEEP = FORMATS.slice(0, 3)
export const formatFor = (type: string): Format => KEEP.find((f) => f.mime === type) ?? FORMATS[0]

/** the format a user picked for the output (Convert image, Merge images), any of them */
export const outputFormat = (mime: string): Format => FORMATS.find((f) => f.mime === mime) ?? FORMATS[0]

/** formats whose files have a quality setting */
export const hasQuality = (mime: string) => mime === 'image/jpeg' || mime === 'image/webp'

export const DEFAULT_QUALITY = 90
