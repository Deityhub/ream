import type { Tool } from '@ream/core'

export const compressPdf: Tool = {
  id: 'compress-pdf',
  title: 'Compress PDF',
  description: 'Make a PDF smaller',
  category: 'pdf',
  icon: 'compress',
  accept: ['.pdf'],
  action: 'Compress PDF',
  multiple: false,
  minFiles: 1,
  preview: 'size',
  status: 'ready',
}
