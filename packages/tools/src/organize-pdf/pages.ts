// The page list the Organize panel edits: plain functions on plain data, tested directly.
export type Turn = 0 | 90 | 180 | 270
/** an output page: which source page (0-based) and how far to turn it clockwise on top of how it already shows */
export type Entry = { src: number; rotate: Turn }

export const original = (count: number): Entry[] => Array.from({ length: count }, (_, src) => ({ src, rotate: 0 }))

export const turn = (e: Entry, by: 90 | -90): Entry => ({ ...e, rotate: ((((e.rotate + by) % 360) + 360) % 360) as Turn })

export const isOriginal = (list: Entry[], count: number) => list.length === count && list.every((e, i) => e.src === i && e.rotate === 0)

/** move the entry at `from` so it ends up at `to` */
export function moveTo<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const out = [...list]
  const [x] = out.splice(from, 1)
  out.splice(to, 0, x)
  return out
}

/** a copy of the entry right after it */
export const duplicate = (list: Entry[], i: number): Entry[] => [...list.slice(0, i + 1), { ...list[i] }, ...list.slice(i + 1)]

export const removeAt = <T,>(list: T[], i: number): T[] => list.filter((_, j) => j !== i)
