import type { Tool } from '@ream/core'

export const organizePdf: Tool = {
  id: 'organize-pdf',
  title: 'Organize pages',
  description: 'Reorder, rotate, copy and delete pages',
  category: 'pdf',
  icon: 'grid',
  accept: ['.pdf'],
  action: 'Save PDF',
  multiple: false,
  minFiles: 1,
  preview: 'none',
  status: 'ready',
}
