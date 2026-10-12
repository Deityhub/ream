import type { Tool } from '@ream/core'
import { mergePdf } from './merge-pdf/manifest'
import { splitPdf } from './split-pdf/manifest'
import { watermark } from './watermark/manifest'
import { imagesToPdf } from './images-to-pdf/manifest'
import { resizeImage } from './resize-image/manifest'
import { convertImage } from './convert-image/manifest'

export const tools: Tool[] = [mergePdf, splitPdf, watermark, imagesToPdf, resizeImage, convertImage]

export const findTool = (id: string) => tools.find((t) => t.id === id)
