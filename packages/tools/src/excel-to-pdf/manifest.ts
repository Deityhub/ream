import type { Tool } from '@ream/core'

export const excelToPdf: Tool = {
  id: 'excel-to-pdf',
  title: 'Excel to PDF',
  description: 'Print a workbook (.xlsx) to PDF',
  category: 'pdf',
  icon: 'grid',
  accept: ['.xlsx'],
  action: 'Save as PDF',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
