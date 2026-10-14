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
import { pageNumbers } from './page-numbers/manifest.ts'
import { cropPdf } from './crop-pdf/manifest.ts'
import { metadata } from './metadata/manifest.ts'
import { extractImages } from './extract-images/manifest.ts'
import { compressImage } from './compress-image/manifest.ts'
import { animatedGif } from './animated-gif/manifest.ts'
import { imageMetadata } from './image-metadata/manifest.ts'
import { compressPdf } from './compress-pdf/manifest.ts'
import { protectPdf } from './protect-pdf/manifest.ts'
import { unlockPdf } from './unlock-pdf/manifest.ts'
import { signPdf } from './sign-pdf/manifest.ts'
import { watermarkImage } from './watermark-image/manifest.ts'
import { blurImage } from './blur-image/manifest.ts'
import { filtersImage } from './filters-image/manifest.ts'
import { meme } from './meme/manifest.ts'

export const tools: Tool[] = [
  mergePdf,
  splitPdf,
  imagesToPdf,
  watermark,
  pageNumbers,
  cropPdf,
  metadata,
  extractImages,
  compressPdf,
  protectPdf,
  unlockPdf,
  signPdf,
  resizeImage,
  convertImage,
  rotateImage,
  cropImage,
  mergeImages,
  compressImage,
  animatedGif,
  imageMetadata,
  watermarkImage,
  blurImage,
  filtersImage,
  meme,
]

export const findTool = (id: string) => tools.find((t) => t.id === id)
