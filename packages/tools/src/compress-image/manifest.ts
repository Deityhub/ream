import type { Tool } from '@ream/core'
import { IMAGE_ACCEPT } from '../image-formats.ts'

export const compressImage: Tool = {
  id: 'compress-image',
  title: 'Compress image',
  description: 'Smaller file sizes for photos and graphics',
  category: 'image',
  icon: 'compress',
  accept: IMAGE_ACCEPT,
  action: 'Compress images',
  multiple: true,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
