import type { Tool } from '@ream/core'

export const cropPdf: Tool = {
  id: 'crop-pdf',
  title: 'Crop PDF',
  description: 'Drag to choose what to keep',
  category: 'pdf',
  icon: 'crop',
  accept: ['.pdf'],
  action: 'Crop PDF',
  multiple: false,
  minFiles: 1,
  preview: 'none', // the selection on the page is the preview
  status: 'ready',
}
