import type { Tool } from '@ream/core'
import { IMAGE_ACCEPT } from '../image-formats.ts'

export const resizeImage: Tool = {
  id: 'resize-image',
  title: 'Resize image',
  description: 'By pixels or percent',
  category: 'image',
  icon: 'resize',
  accept: IMAGE_ACCEPT,
  action: 'Resize images',
  multiple: true,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
