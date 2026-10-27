import type { Tool } from '@ream/core'
import { IMAGE_ACCEPT } from '../image-formats.ts'

export const watermarkImage: Tool = {
  id: 'watermark-image',
  title: 'Watermark image',
  description: 'Stamp text or a logo on pictures',
  category: 'image',
  icon: 'droplet',
  accept: IMAGE_ACCEPT,
  action: 'Add watermark',
  multiple: true,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
