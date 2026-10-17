import type { Tool } from '@ream/core'

export const powerpointToPdf: Tool = {
  id: 'powerpoint-to-pdf',
  title: 'PowerPoint to PDF',
  description: 'Save a presentation (.pptx) as a PDF, one page per slide',
  category: 'pdf',
  icon: 'layers',
  accept: ['.pptx'],
  action: 'Save as PDF',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
