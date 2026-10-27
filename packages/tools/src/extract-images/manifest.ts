import type { Tool } from '@ream/core'

export const extractImages: Tool = {
  id: 'extract-images',
  title: 'Extract images',
  description: 'Save the pictures inside a PDF',
  category: 'pdf',
  icon: 'images',
  accept: ['.pdf'],
  action: 'Extract images',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
