import type { Tool } from '@ream/core'

export const editPdf: Tool = {
  id: 'edit-pdf',
  title: 'Edit PDF',
  description: 'Add text, pictures, shapes, drawings and comments',
  category: 'pdf',
  icon: 'pen',
  accept: ['.pdf'],
  action: 'Save edited PDF',
  multiple: false,
  minFiles: 1,
  preview: 'none', // the editor on the page is the preview
  status: 'ready',
}
