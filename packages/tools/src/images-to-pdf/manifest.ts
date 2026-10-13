import type { Tool } from '@ream/core'

export const imagesToPdf: Tool = {
  id: 'images-to-pdf',
  title: 'Images to PDF',
  description: 'JPG and PNG into one PDF',
  category: 'pdf',
  icon: 'image',
  accept: ['image/jpeg', 'image/png'],
  action: 'Create PDF',
  multiple: true,
  minFiles: 1,
  status: 'soon',
}
