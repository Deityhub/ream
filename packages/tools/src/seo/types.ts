/**
 * The words of a tool's own page (ream.deityhub.com/tool/<id>/): what search engines list and what a visitor reads under
 * the tool. Plain, true claims only: say what the tool does and where it stops (no OCR, no certificate signatures...).
 * `seo.test.ts` checks the lengths and that every tool has an entry.
 */
export type ToolSeo = {
  /** the page's title in search results, 60 characters at most, ending in "| Ream" */
  title: string
  /** the snippet under it, 70 to 155 characters */
  description: string
  /** the paragraph under the heading: what the tool does, in plain words */
  intro: string
  /** three short things you can do with it */
  points: string[]
  /** two questions people ask, with straight answers */
  faq: [question: string, answer: string][]
}
