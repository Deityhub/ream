import type { Tool } from '@ream/core'

export const imageMetadata: Tool = {
  id: 'image-metadata',
  title: 'Photo metadata',
  description: 'See and remove camera and location data',
  category: 'image',
  icon: 'tag',
  accept: ['image/jpeg', 'image/png'],
  action: 'Remove metadata',
  multiple: true,
  minFiles: 1,
  preview: 'none',
  status: 'ready',
}
