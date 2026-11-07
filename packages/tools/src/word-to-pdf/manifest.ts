import type { Tool } from '@ream/core'

export const wordToPdf: Tool = {
  id: 'word-to-pdf',
  title: 'Word to PDF',
  description: 'Save a Word document (.docx) as PDF',
  category: 'pdf',
  icon: 'file',
  accept: ['.docx'],
  action: 'Save as PDF',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
