import type { Tool } from '@ream/core'
import { IMAGE_ACCEPT } from '../image-formats.ts'

export const rotateImage: Tool = {
  id: 'rotate-image',
  title: 'Rotate and flip',
  description: 'Turn or mirror images',
  category: 'image',
  icon: 'rotate',
  accept: IMAGE_ACCEPT,
  action: 'Apply',
  multiple: true,
  minFiles: 1,
  status: 'ready',
}
