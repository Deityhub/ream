// Constants only (no engine imports), so manifests and option panels can use them without pulling in image-core.
import type { OutputMime } from '@ream/image-core'

/** what the browser decoders can open; HEIC, TIFF and RAW need their own decoders later */
export const IMAGE_ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']

export type Format = { mime: OutputMime; ext: string; label: string }

export const FORMATS: Format[] = [
  { mime: 'image/png', ext: 'png', label: 'PNG' },
  { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' },
  { mime: 'image/webp', ext: 'webp', label: 'WebP' },
]

/** the format to save an input in when the tool keeps formats; formats we can't write become PNG */
export const formatFor = (type: string): Format => FORMATS.find((f) => f.mime === type) ?? FORMATS[0]

export const DEFAULT_QUALITY = 90
