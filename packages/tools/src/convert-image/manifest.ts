import type { Tool } from '@ream/core'

export const convertImage: Tool = {
  id: 'convert-image',
  title: 'Convert image',
  description: 'PNG, JPG, WebP, GIF',
  category: 'image',
  icon: 'refresh',
  accept: ['image/*'],
  action: 'Convert images',
  multiple: true,
  minFiles: 1,
  status: 'soon',
}
