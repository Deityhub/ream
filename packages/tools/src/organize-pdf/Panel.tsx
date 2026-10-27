import { useEffect, useState, type DragEvent } from 'react'
import { Button, Icon } from '@ream/ui'
import type { PanelProps, PdfHost } from '../panels.ts'
import { duplicate, isOriginal, moveTo, original, removeAt, turn, type Entry } from './pages.ts'
import type { OrganizeOptions as O } from './run.ts'

export const defaultOptions: O = { pages: null }

type Size = { width: number; height: number }
const THUMB = 220 // pixels a thumbnail is drawn across; the cell shows it smaller

function Tool({ label, icon, flip, disabled, onClick }: { label: string; icon: string; flip?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-1.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30 disabled:hover:bg-transparent pointer-coarse:p-3"
    >
      <Icon name={icon} className={`size-4 ${flip ? '-scale-x-100' : ''}`} />
    </button>
  )
}

/** one page of the new file: the source page drawn turned the way it will come out */
function Thumb({ LazyPage, file, size, entry }: { LazyPage: PdfHost['LazyPage']; file: File; size: Size; entry: Entry }) {
  const sideways = entry.rotate % 180 === 90
  const [dw, dh] = sideways ? [size.height, size.width] : [size.width, size.height]
  return (
    <div className="relative w-full overflow-hidden bg-white ring-1 ring-line" style={{ aspectRatio: `${dw} / ${dh}` }}>
      <div className="absolute left-1/2 top-1/2" style={{ width: `${(size.width / dw) * 100}%`, height: `${(size.height / dh) * 100}%`, transform: `translate(-50%, -50%) rotate(${entry.rotate}deg)` }}>
        <LazyPage file={file} page={entry.src} size={size} renderWidth={THUMB} />
      </div>
    </div>
  )
}

export function Panel({ options: o, onChange, files, pdfHost }: PanelProps<O>) {
  const file = files[0]
  const [sizes, setSizes] = useState<Size[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [from, setFrom] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  useEffect(() => {
    setSizes(null)
    setFailed(false)
    onChange(defaultOptions)
    if (!file || !pdfHost) return
    let live = true
    pdfHost.pages(file).then(
      (p) => {
        if (!live) return
        setSizes(p)
        onChange({ pages: original(p.length) })
      },
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, pdfHost])

  if (failed) return <p className="text-sm text-muted">This PDF can't be shown here, so its pages can't be arranged.</p>
  if (!sizes || !o.pages || !pdfHost || !file) return <p className="text-sm text-muted">Reading the pages…</p>

  const list = o.pages
  const set = (pages: Entry[]) => onChange({ pages })
  const same = isOriginal(list, sizes.length)
  const drop = (e: DragEvent, to: number) => {
    e.preventDefault()
    if (from !== null) set(moveTo(list, from, to))
    setFrom(null)
    setOver(null)
  }
  // a source page used again gets a number so every cell has a stable key
  const seen = new Map<number, number>()

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          {list.length} {list.length === 1 ? 'page' : 'pages'} in the new file
          {list.length !== sizes.length && <span className="font-normal text-muted"> (from {sizes.length})</span>}
        </h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => set([...list].reverse())} disabled={list.length < 2}>
            Reverse order
          </Button>
          <Button variant="secondary" onClick={() => set(original(sizes.length))} disabled={same}>
            Start again
          </Button>
        </div>
      </div>
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
        {list.map((entry, i) => {
          const n = (seen.get(entry.src) ?? 0) + 1
          seen.set(entry.src, n)
          return (
            <li key={`${entry.src}:${n}`} className="space-y-1.5">
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', String(i))
                  setFrom(i)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setOver(i)
                }}
                onDrop={(e) => drop(e, i)}
                onDragEnd={() => {
                  setFrom(null)
                  setOver(null)
                }}
                className={`cursor-grab rounded-sm p-1 ${from === i ? 'opacity-40' : ''} ${over === i && from !== null && from !== i ? 'bg-accent-soft outline-2 outline-accent' : ''}`}
              >
                <Thumb LazyPage={pdfHost.LazyPage} file={file} size={sizes[entry.src]} entry={entry} />
              </div>
              <p className="text-center text-xs text-muted">
                <span className="font-medium text-ink">{i + 1}</span>
                {entry.src !== i && ` · was page ${entry.src + 1}`}
              </p>
              <div className="flex flex-wrap justify-center">
                <Tool label={`Move page ${i + 1} earlier`} icon="arrow-left" disabled={i === 0} onClick={() => set(moveTo(list, i, i - 1))} />
                <Tool label={`Move page ${i + 1} later`} icon="arrow-right" disabled={i === list.length - 1} onClick={() => set(moveTo(list, i, i + 1))} />
                <Tool label={`Turn page ${i + 1} left`} icon="rotate" flip onClick={() => set(list.map((x, j) => (j === i ? turn(x, -90) : x)))} />
                <Tool label={`Turn page ${i + 1} right`} icon="rotate" onClick={() => set(list.map((x, j) => (j === i ? turn(x, 90) : x)))} />
                <Tool label={`Copy page ${i + 1}`} icon="files" onClick={() => set(duplicate(list, i))} />
                <Tool label={`Delete page ${i + 1}`} icon="x" disabled={list.length === 1} onClick={() => set(removeAt(list, i))} />
              </div>
            </li>
          )
        })}
      </ol>
      <p className="text-xs text-muted">Drag a page to move it, or use the buttons. Bookmarks follow their pages; a copy of a page is stored once. Tagged structure and layers are left out.</p>
    </div>
  )
}
