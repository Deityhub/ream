import type { Tool } from '@ream/core'

export const flattenPdfTool: Tool = {
  id: 'flatten-pdf',
  title: 'Flatten PDF',
  description: 'Make form fields and comments part of the page',
  category: 'pdf',
  icon: 'layers',
  accept: ['.pdf'],
  action: 'Flatten PDF',
  multiple: false,
  minFiles: 1,
  preview: 'none',
  status: 'ready',
}
