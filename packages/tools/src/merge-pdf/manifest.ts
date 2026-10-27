import type { Tool } from '@ream/core'

export const mergePdf: Tool = {
  id: 'merge-pdf',
  title: 'Merge PDF',
  description: 'Combine PDFs into one',
  category: 'pdf',
  icon: 'files',
  accept: ['.pdf'],
  action: 'Merge PDFs',
  multiple: true,
  minFiles: 2,
  preview: 'live',
  status: 'ready',
}
