import type { Tool } from '@ream/core'

export const resizeImage: Tool = {
  id: 'resize-image',
  title: 'Resize image',
  description: 'By pixels or percent',
  category: 'image',
  icon: 'resize',
  accept: ['image/*'],
  status: 'soon',
}
