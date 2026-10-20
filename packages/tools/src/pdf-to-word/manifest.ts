import type { Tool } from '@ream/core'

export const pdfToWord: Tool = {
  id: 'pdf-to-word',
  title: 'PDF to Word',
  description: 'Turn pages into an editable Word document',
  category: 'pdf',
  icon: 'file',
  accept: ['.pdf'],
  action: 'Save as Word',
  multiple: false,
  minFiles: 1,
  preview: 'none',
  status: 'ready',
}
