import type { Tool } from '@ream/core'

export const protectPdf: Tool = {
  id: 'protect-pdf',
  title: 'Protect PDF',
  description: 'Lock a PDF with a password',
  category: 'pdf',
  icon: 'lock',
  accept: ['.pdf'],
  action: 'Protect PDF',
  multiple: false,
  minFiles: 1,
  preview: 'none', // a protected file can't be shown without its password
  status: 'ready',
}
