import { UserError, type RunFn } from '@ream/core'
import { compose } from '@ream/pdf-core'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'
import { isOriginal, type Entry } from './pages.ts'

/** `pages: null` means the panel hasn't read the file yet */
export type OrganizeOptions = { pages: Entry[] | null }

export const run: RunFn<OrganizeOptions> = async (files, { pages }, { progress }) => {
  if (!pages) throw new UserError('The pages are still being read. Try again in a moment.')
  if (!pages.length) throw new UserError('Keep at least one page.')
  const doc = await loadPdf(files[0])
  const count = doc.pages().length
  if (pages.some((p) => !Number.isInteger(p.src) || p.src < 0 || p.src >= count || ![0, 90, 180, 270].includes(p.rotate))) throw new UserError("The page list doesn't match this file. Close it and open the file again.")
  if (isOriginal(pages, count)) throw new UserError('Nothing has changed yet. Move, turn, copy or delete a page first.')
  // one part per output page, so every copy can be turned on its own; a source page used twice is stored once
  const bytes = compose(pages.map((p) => ({ doc, pages: [p.src], rotate: () => p.rotate })))
  progress(1)
  return [pdfFile(`${baseName(files[0].name)}-organized.pdf`, bytes)]
}
