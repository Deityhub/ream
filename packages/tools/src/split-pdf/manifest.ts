import type { Tool } from '@ream/core'

export const splitPdf: Tool = {
  id: 'split-pdf',
  title: 'Split PDF',
  description: 'Into page ranges, or a new file every N pages',
  category: 'pdf',
  icon: 'scissors',
  accept: ['.pdf'],
  action: 'Split PDF',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
