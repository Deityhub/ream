// The bookmark tree as the panel edits it: plain functions on plain data, no React, so they are tested directly.
// A path is the position of an entry: [2, 0] is the first child of the third top-level entry.
import type { OutlineItem } from '@ream/pdf-core'

export type Path = number[]
export type Row = { path: Path; item: OutlineItem; depth: number }

export const NEW_ITEM = (page: number): OutlineItem => ({ title: 'New bookmark', page, fit: ['Fit'], open: false, children: [] })

/** the entries in the order they are shown, each with where it is */
export function rows(items: OutlineItem[], prefix: Path = []): Row[] {
  return items.flatMap((item, i) => [{ path: [...prefix, i], item, depth: prefix.length }, ...rows(item.children, [...prefix, i])])
}

/** a copy of the tree with the list at `path` (the top level for []) replaced by what `change` makes of it */
function atList(items: OutlineItem[], path: Path, change: (list: OutlineItem[]) => OutlineItem[]): OutlineItem[] {
  if (!path.length) return change(items)
  const [i, ...rest] = path
  return items.map((it, j) => (j === i ? { ...it, children: atList(it.children, rest, change) } : it))
}

/** how many entries share a level with the one at `path` (itself included) */
export function siblings(items: OutlineItem[], path: Path): number {
  let list = items
  for (const i of path.slice(0, -1)) list = list[i].children
  return list.length
}

const parentOf = (path: Path) => path.slice(0, -1)
const last = (path: Path) => path[path.length - 1]

export const update = (items: OutlineItem[], path: Path, patch: Partial<OutlineItem>) =>
  atList(items, parentOf(path), (l) => l.map((it, j) => (j === last(path) ? { ...it, ...patch } : it)))

export const remove = (items: OutlineItem[], path: Path) => atList(items, parentOf(path), (l) => l.filter((_, j) => j !== last(path)))

/** insert after the entry at `path` (same level); with no path, at the end of the top level */
export function insertAfter(items: OutlineItem[], path: Path | null, item: OutlineItem): OutlineItem[] {
  if (!path) return [...items, item]
  return atList(items, parentOf(path), (l) => [...l.slice(0, last(path) + 1), item, ...l.slice(last(path) + 1)])
}

/** one place earlier (-1) or later (+1) among its neighbours; unchanged at the ends */
export function move(items: OutlineItem[], path: Path, by: -1 | 1): OutlineItem[] {
  return atList(items, parentOf(path), (l) => {
    const i = last(path)
    const j = i + by
    if (j < 0 || j >= l.length) return l
    const out = [...l]
    ;[out[i], out[j]] = [out[j], out[i]]
    return out
  })
}

/** becomes the last child of the entry before it; no change for the first entry of a level */
export function indent(items: OutlineItem[], path: Path): OutlineItem[] {
  const i = last(path)
  if (i === 0) return items
  return atList(items, parentOf(path), (l) => {
    const prev = l[i - 1]
    return [...l.slice(0, i - 1), { ...prev, open: true, children: [...prev.children, l[i]] }, ...l.slice(i + 1)]
  })
}

/** becomes the entry after its parent, taking the entries that followed it along as its own children; no change at the top level */
export function outdent(items: OutlineItem[], path: Path): OutlineItem[] {
  if (path.length < 2) return items
  const parent = parentOf(path)
  const i = last(path)
  let moved: OutlineItem | null = null
  const without = atList(items, parent, (l) => {
    moved = { ...l[i], children: [...l[i].children, ...l.slice(i + 1)] }
    return l.slice(0, i)
  })
  return insertAfter(without, parent, moved!)
}
