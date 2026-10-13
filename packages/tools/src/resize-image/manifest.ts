import type { Tool } from '@ream/core'

export const resizeImage: Tool = {
  id: 'resize-image',
  title: 'Resize image',
  description: 'By pixels or percent',
  category: 'image',
  icon: 'resize',
  accept: ['image/*'],
  action: 'Resize images',
  multiple: true,
  minFiles: 1,
  status: 'soon',
}
