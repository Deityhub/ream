import type { Tool } from '@ream/core'

export const unlockPdf: Tool = {
  id: 'unlock-pdf',
  title: 'Unlock PDF',
  description: 'Remove a password and its limits',
  category: 'pdf',
  icon: 'lock-open',
  accept: ['.pdf'],
  action: 'Unlock PDF',
  multiple: false,
  minFiles: 1,
  preview: 'none',
  status: 'ready',
}
