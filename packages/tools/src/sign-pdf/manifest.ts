import type { Tool } from '@ream/core'

export const signPdf: Tool = {
  id: 'sign-pdf',
  title: 'Sign PDF',
  description: 'Place your signature on a page',
  category: 'pdf',
  icon: 'pen',
  accept: ['.pdf'],
  action: 'Sign PDF',
  multiple: false,
  minFiles: 1,
  preview: 'none', // the page with the signature on it is the preview
  status: 'ready',
}
