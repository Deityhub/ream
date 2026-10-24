import type { Tool } from '@ream/core'
import { IMAGE_ACCEPT } from '../image-formats.ts'

export const convertImage: Tool = {
  id: 'convert-image',
  title: 'Convert image',
  description: 'Change between PNG, JPG, WebP, GIF and BMP',
  category: 'image',
  icon: 'refresh',
  accept: IMAGE_ACCEPT,
  action: 'Convert images',
  multiple: true,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
