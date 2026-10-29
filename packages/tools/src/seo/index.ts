import type { Tool } from '@ream/core'
import { convertSeo } from './convert.ts'
import { imageSeo } from './image.ts'
import { pdfSeo } from './pdf.ts'
import type { ToolSeo } from './types.ts'

export type { ToolSeo } from './types.ts'

/** the page text of every tool, by id (`seo.test.ts` fails when a tool has none) */
export const toolSeo: Record<string, ToolSeo> = { ...pdfSeo, ...convertSeo, ...imageSeo }

/** a tool's page text; one made from its manifest when nothing has been written yet, so a new tool never ships without a page */
export function seoOf(tool: Tool): ToolSeo {
  return (
    toolSeo[tool.id] ?? {
      title: `${tool.title} online | Ream`,
      description: `${tool.description}. It runs on your device, so your files are never uploaded.`,
      intro: `${tool.description}. It runs on your device, so your files are never uploaded.`,
      points: [],
      faq: [],
    }
  )
}
