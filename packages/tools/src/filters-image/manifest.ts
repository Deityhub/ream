import type { Tool } from '@ream/core'
import { IMAGE_ACCEPT } from '../image-formats.ts'

export const filtersImage: Tool = {
  id: 'filters-image',
  title: 'Filters',
  description: 'Looks, colour and sharpness',
  category: 'image',
  icon: 'sliders',
  accept: IMAGE_ACCEPT,
  action: 'Apply filters',
  multiple: true,
  minFiles: 1,
  preview: 'live',
  status: 'ready',
}
