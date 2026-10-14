import type { Tool } from '@ream/core'

export const bookmarksPdf: Tool = {
  id: 'bookmarks-pdf',
  title: 'Bookmarks',
  description: 'Add, rename and reorder the outline',
  category: 'pdf',
  icon: 'list',
  accept: ['.pdf'],
  action: 'Save bookmarks',
  multiple: false,
  minFiles: 1,
  preview: 'none',
  status: 'ready',
}
