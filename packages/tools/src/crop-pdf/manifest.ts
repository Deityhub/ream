import type { Tool } from '@ream/core'

export const cropPdf: Tool = {
  id: 'crop-pdf',
  title: 'Crop PDF',
  description: 'Trim the margins of every page',
  category: 'pdf',
  icon: 'crop',
  accept: ['.pdf'],
  action: 'Crop PDF',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
