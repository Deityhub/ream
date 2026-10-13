import type { Tool } from '@ream/core'
import { IMAGE_ACCEPT } from '../image-formats.ts'

export const cropImage: Tool = {
  id: 'crop-image',
  title: 'Crop image',
  description: 'Keep just the area you choose',
  category: 'image',
  icon: 'crop',
  accept: IMAGE_ACCEPT,
  action: 'Crop image',
  multiple: false,
  minFiles: 1,
  status: 'ready',
}
