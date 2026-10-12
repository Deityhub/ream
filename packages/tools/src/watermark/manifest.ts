import type { Tool } from '@ream/core'

export const watermark: Tool = {
  id: 'watermark',
  title: 'Watermark PDF',
  description: 'Stamp text over every page',
  category: 'pdf',
  icon: 'droplet',
  accept: ['.pdf'],
  status: 'soon',
}
