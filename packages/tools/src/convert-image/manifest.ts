import type { Tool } from '@ream/core'

export const convertImage: Tool = {
  id: 'convert-image',
  title: 'Convert image',
  description: 'PNG, JPG, WebP, GIF',
  category: 'image',
  icon: 'refresh',
  accept: ['image/*'],
  status: 'soon',
}
