import type { Tool } from '@ream/core'

export const repairPdf: Tool = {
  id: 'repair-pdf',
  title: 'Repair PDF',
  description: 'Recover a damaged file as a clean copy',
  category: 'pdf',
  icon: 'wrench',
  accept: ['.pdf'],
  action: 'Repair PDF',
  multiple: false,
  minFiles: 1,
  preview: 'none',
  status: 'ready',
}
