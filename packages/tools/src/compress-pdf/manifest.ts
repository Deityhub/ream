import type { Tool } from '@ream/core'

export const compressPdf: Tool = {
  id: 'compress-pdf',
  title: 'Compress PDF',
  description: 'Smaller file size, with the same pages and text',
  category: 'pdf',
  icon: 'compress',
  accept: ['.pdf'],
  action: 'Compress PDF',
  multiple: false,
  minFiles: 1,
  preview: 'size',
  status: 'ready',
}
