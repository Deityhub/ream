import type { Tool } from '@ream/core'
import { IMAGE_ACCEPT } from '../image-formats.ts'

export const mergeImages: Tool = {
  id: 'merge-images',
  title: 'Merge images',
  description: 'Join into one image or grid',
  category: 'image',
  icon: 'grid',
  accept: IMAGE_ACCEPT,
  action: 'Merge images',
  multiple: true,
  minFiles: 2,
  preview: 'live',
  status: 'ready',
}
