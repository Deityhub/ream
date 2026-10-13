import type { Tool } from '@ream/core'

export const splitPdf: Tool = {
  id: 'split-pdf',
  title: 'Split PDF',
  description: 'By range or every N pages',
  category: 'pdf',
  icon: 'scissors',
  accept: ['.pdf'],
  action: 'Split PDF',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
