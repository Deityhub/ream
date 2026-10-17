import type { Tool } from '@ream/core'

export const pdfToExcel: Tool = {
  id: 'pdf-to-excel',
  title: 'PDF to Excel',
  description: 'Get tables out as an Excel workbook',
  category: 'pdf',
  icon: 'grid',
  accept: ['.pdf'],
  action: 'Save as Excel',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
