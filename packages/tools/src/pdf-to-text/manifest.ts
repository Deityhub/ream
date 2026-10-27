import type { Tool } from '@ream/core'

export const pdfToText: Tool = {
  id: 'pdf-to-text',
  title: 'PDF to text',
  description: 'Get the text out, as plain text or Markdown',
  category: 'pdf',
  icon: 'text',
  accept: ['.pdf'],
  action: 'Extract text',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
