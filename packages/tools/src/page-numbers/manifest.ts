import type { Tool } from '@ream/core'

export const pageNumbers: Tool = {
  id: 'page-numbers',
  title: 'Page numbers',
  description: 'Number the pages of a PDF',
  category: 'pdf',
  icon: 'hash',
  accept: ['.pdf'],
  action: 'Add page numbers',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
