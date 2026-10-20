import type { Tool } from '@ream/core'

export const fillPdfForm: Tool = {
  id: 'fill-pdf-form',
  title: 'Fill PDF form',
  description: 'Type into the form fields of a PDF',
  category: 'pdf',
  icon: 'form',
  accept: ['.pdf'],
  action: 'Save filled PDF',
  multiple: false,
  minFiles: 1,
  preview: 'none', // the fields are filled on the page itself
  status: 'ready',
}
