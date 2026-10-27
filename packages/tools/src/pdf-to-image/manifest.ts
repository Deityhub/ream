import type { Tool } from '@ream/core'

export const pdfToImage: Tool = {
  id: 'pdf-to-image',
  title: 'PDF to image',
  description: 'Save pages as PNG or JPG pictures',
  category: 'pdf',
  icon: 'image',
  accept: ['.pdf'],
  action: 'Save pages as images',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
