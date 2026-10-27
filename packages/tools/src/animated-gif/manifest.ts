import type { Tool } from '@ream/core'
import { IMAGE_ACCEPT } from '../image-formats.ts'

export const animatedGif: Tool = {
  id: 'animated-gif',
  title: 'Animated GIF',
  description: 'Turn images into a looping GIF',
  category: 'image',
  icon: 'film',
  accept: IMAGE_ACCEPT,
  action: 'Make GIF',
  multiple: true,
  minFiles: 2,
  preview: 'live',
  status: 'ready',
}
