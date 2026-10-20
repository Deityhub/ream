import type { Tool } from '@ream/core'

export const redactPdf: Tool = {
  id: 'redact-pdf',
  title: 'Redact PDF',
  description: 'Black out and remove parts of pages for good',
  category: 'pdf',
  icon: 'redact',
  accept: ['.pdf'],
  action: 'Redact PDF',
  multiple: false,
  minFiles: 1,
  preview: 'none', // the areas on the page are the preview
  status: 'ready',
}
