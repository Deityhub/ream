import type { Tool } from '@ream/core'
import { IMAGE_ACCEPT } from '../image-formats.ts'

export const blurImage: Tool = {
  id: 'blur-image',
  title: 'Blur or hide parts',
  description: 'Blur, pixelate or cover faces and details',
  category: 'image',
  icon: 'eye-off',
  accept: IMAGE_ACCEPT,
  action: 'Save picture',
  multiple: false,
  minFiles: 1,
  preview: 'none',
  status: 'ready',
}
