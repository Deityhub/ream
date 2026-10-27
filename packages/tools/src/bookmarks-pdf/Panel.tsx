import { useEffect, useState } from 'react'
import { Button, Icon } from '@ream/ui'
import type { PanelProps } from '../panels.ts'
import { inputClass } from '../fields.tsx'
import { NEW_ITEM, indent, insertAfter, move, outdent, remove, rows, siblings, update, type Path } from './tree.ts'
import type { BookmarksOptions as O } from './run.ts'

export const defaultOptions: O = { items: null }

const same = (a: Path | null, b: Path) => !!a && a.length === b.length && a.every((v, i) => v === b[i])

function Tool({ label, icon, disabled, onClick }: { label: string; icon: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-1.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30 disabled:hover:bg-transparent pointer-coarse:p-3"
    >
      <Icon name={icon} className="size-4" />
    </button>
  )
}

export function Panel({ options: o, onChange, files, pdfHost }: PanelProps<O>) {
  const file = files[0]
  const [pages, setPages] = useState(0)
  const [selected, setSelected] = useState<Path | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    onChange(defaultOptions)
    setSelected(null)
    setFailed(false)
    if (!file || !pdfHost) return
    let live = true
    Promise.all([pdfHost.pages(file), pdfHost.outline(file)]).then(
      ([p, items]) => {
        if (!live) return
        setPages(p.length)
        onChange({ items })
      },
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, pdfHost])

  if (failed) return <p className="text-sm text-muted">This file couldn't be read, so its bookmarks can't be shown.</p>
  if (!o.items) return <p className="text-sm text-muted">Reading the bookmarks…</p>
  const items = o.items
  const all = rows(items)
  const set = (next: typeof items, follow: Path | null = selected) => {
    onChange({ items: next })
    setSelected(follow)
  }
  const add = () => {
    const at = selected && all.find((r) => same(selected, r.path)) ? selected : null
    const next = insertAfter(items, at, NEW_ITEM(0))
    set(next, at ? [...at.slice(0, -1), at[at.length - 1] + 1] : [next.length - 1])
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Bookmarks</h2>
        <Button variant="secondary" onClick={add}>
          Add bookmark
        </Button>
      </div>
      {all.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">This file has no bookmarks. Add one to make the outline readers show beside the pages.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {all.map(({ path, item, depth }) => {
            const on = same(selected, path)
            const count = siblings(items, path)
            const i = path[path.length - 1]
            return (
              <li key={path.join('.')} onFocus={() => setSelected(path)} className={`flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 pr-2 ${on ? 'bg-accent-soft' : ''}`} style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}>
                <input
                  type="text"
                  value={item.title}
                  aria-label="Bookmark name"
                  onChange={(e) => set(update(items, path, { title: e.target.value }), path)}
                  className={`${inputClass} min-w-40 flex-1`}
                />
                <label className="flex items-center gap-1 text-sm">
                  <span className="text-muted">Page</span>
                  <input
                    type="number"
                    min={1}
                    max={pages || undefined}
                    value={item.page === null ? '' : item.page + 1}
                    placeholder="none"
                    aria-label={`Page for ${item.title || 'this bookmark'}`}
                    onChange={(e) => {
                      const n = Math.floor(Number(e.target.value))
                      // a new page means the old position on the old page no longer applies
                      set(update(items, path, e.target.value === '' ? { page: null, fit: [] } : { page: Math.min(Math.max(n || 1, 1), pages || 1) - 1, fit: ['Fit'] }), path)
                    }}
                    className={`${inputClass} w-20`}
                  />
                </label>
                <span className="flex items-center">
                  <Tool label={`Move ${item.title} up`} icon="arrow-up" disabled={i === 0} onClick={() => set(move(items, path, -1), [...path.slice(0, -1), i - 1])} />
                  <Tool label={`Move ${item.title} down`} icon="arrow-down" disabled={i === count - 1} onClick={() => set(move(items, path, 1), [...path.slice(0, -1), i + 1])} />
                  <Tool label={`Make ${item.title} a sub-bookmark of the one above`} icon="arrow-right" disabled={i === 0} onClick={() => set(indent(items, path), [...path.slice(0, -1), i - 1, all.find((r) => same(r.path, [...path.slice(0, -1), i - 1]))!.item.children.length])} />
                  <Tool label={`Move ${item.title} out one level`} icon="arrow-left" disabled={depth === 0} onClick={() => set(outdent(items, path), path.slice(0, -1))} />
                  <Tool label={`Remove ${item.title}`} icon="x" onClick={() => set(remove(items, path), null)} />
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-muted">Leave the page empty for a heading that goes nowhere. Removing a bookmark removes the ones inside it. Everything else in the file stays as it is.</p>
    </div>
  )
}
