import { UserError, type RunFn } from '@ream/core'
import { editDocument, writeOutline, type OutlineItem } from '@ream/pdf-core'
import { baseName, loadPdf, pdfFile } from '../pdf-common.ts'

/** `items: null` means the panel hasn't read the file's bookmarks yet */
export type BookmarksOptions = { items: OutlineItem[] | null }

const count = (items: OutlineItem[]): number => items.reduce((n, i) => n + 1 + count(i.children), 0)

export const run: RunFn<BookmarksOptions> = async (files, { items }) => {
  if (!items) throw new UserError('The bookmarks are still being read. Try again in a moment.')
  const doc = await loadPdf(files[0])
  const pages = doc.pages().length
  const check = (list: OutlineItem[]) => {
    for (const it of list) {
      if (!it.title.trim()) throw new UserError('Give every bookmark a name, or remove it.')
      if (it.page !== null && (!Number.isInteger(it.page) || it.page < 0 || it.page >= pages)) throw new UserError(`"${it.title}" points at page ${(it.page ?? 0) + 1}, but the file has ${pages} ${pages === 1 ? 'page' : 'pages'}.`)
      check(it.children)
    }
  }
  check(items)
  if (count(items) > 5000) throw new UserError('That is too many bookmarks. Keep it under 5,000.')
  const bytes = await editDocument(doc, (e) => {
    const root = writeOutline(e, items, e.pageRefs)
    if (root) e.catalog.set('Outlines', root)
    else e.catalog.delete('Outlines')
  })
  return [pdfFile(`${baseName(files[0].name)}-bookmarks.pdf`, bytes)]
}
