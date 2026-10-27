import type { Tool } from '@ream/core'

export const metadata: Tool = {
  id: 'metadata',
  title: 'Edit metadata',
  description: 'Title, author, subject and keywords',
  category: 'pdf',
  icon: 'info',
  accept: ['.pdf'],
  action: 'Save metadata',
  multiple: false,
  minFiles: 1,
  preview: 'none',
  status: 'ready',
}
