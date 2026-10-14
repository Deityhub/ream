import type { Tool } from '@ream/core'
import { IMAGE_ACCEPT } from '../image-formats.ts'

export const meme: Tool = {
  id: 'meme',
  title: 'Meme maker',
  description: 'Add captions at the top and bottom',
  category: 'image',
  icon: 'type',
  accept: IMAGE_ACCEPT,
  action: 'Make meme',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
