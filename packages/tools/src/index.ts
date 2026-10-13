import type { Tool } from '@ream/core'
import { mergePdf } from './merge-pdf/manifest.ts'
import { splitPdf } from './split-pdf/manifest.ts'
import { watermark } from './watermark/manifest.ts'
import { imagesToPdf } from './images-to-pdf/manifest.ts'
import { resizeImage } from './resize-image/manifest.ts'
import { convertImage } from './convert-image/manifest.ts'
import { rotateImage } from './rotate-image/manifest.ts'
import { cropImage } from './crop-image/manifest.ts'
import { mergeImages } from './merge-images/manifest.ts'

export const tools: Tool[] = [
  mergePdf,
  splitPdf,
  watermark,
  imagesToPdf,
  resizeImage,
  convertImage,
  rotateImage,
  cropImage,
  mergeImages,
]

export const findTool = (id: string) => tools.find((t) => t.id === id)
