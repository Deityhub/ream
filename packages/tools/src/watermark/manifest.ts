import type { Tool } from '@ream/core'

export const watermark: Tool = {
  id: 'watermark',
  title: 'Watermark PDF',
  description: 'Stamp text over every page',
  category: 'pdf',
  icon: 'droplet',
  accept: ['.pdf'],
  action: 'Add watermark',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'soon',
}
