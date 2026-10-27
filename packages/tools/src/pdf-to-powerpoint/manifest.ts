import type { Tool } from '@ream/core'

export const pdfToPowerpoint: Tool = {
  id: 'pdf-to-powerpoint',
  title: 'PDF to PowerPoint',
  description: 'Turn pages into slides you can edit',
  category: 'pdf',
  icon: 'layers',
  accept: ['.pdf'],
  action: 'Save as PowerPoint',
  multiple: false,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
