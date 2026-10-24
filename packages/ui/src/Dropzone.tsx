import { useState } from 'react'
import { acceptsFile } from '@ream/core'
import { Icon } from './Icon.tsx'

type Props = {
  accept: string[]
  multiple?: boolean
  onFiles: (files: File[]) => void
  /** a slim "add more" bar instead of the big drop area */
  compact?: boolean
  /** a wide bar with its own wording and a button on the right (the tools home) */
  bar?: { title: string; hint: string }
}

export function Dropzone({ accept, multiple = true, onFiles, compact = false, bar }: Props) {
  const [over, setOver] = useState(false)
  const [skipped, setSkipped] = useState(0)
  const take = (list: FileList | null) => {
    // drag-and-drop ignores the input's accept attribute, so filter here too
    const all = Array.from(list ?? [])
    const files = all.filter((f) => acceptsFile(f, accept))
    setSkipped(all.length - files.length)
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }
  const noun = multiple ? 'files' : 'a file'
  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
        className={`flex cursor-pointer border-dashed transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${over ? 'border-accent bg-accent-soft' : 'border-field bg-canvas hover:bg-accent-soft'} ${
          compact
            ? 'items-center justify-center gap-2 rounded-[10px] border px-3 py-2.5 text-sm'
            : bar
              ? 'flex-wrap items-center gap-5 rounded-2xl border-[1.5px] px-6 py-5'
              : 'flex-col items-center justify-center gap-3 rounded-2xl border-[1.5px] px-6 py-12 text-center'
        }`}
      >
        {compact ? (
          <>
            <Icon name="upload" className="size-4 text-accent-ink" />
            <span className="text-accent-ink">{multiple ? 'Add more files' : 'Replace file'}</span>
          </>
        ) : bar ? (
          <>
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
              <Icon name="upload" className="size-6" />
            </span>
            <span className="min-w-0 flex-[1_1_16rem]">
              <span className="block font-bold">{bar.title}</span>
              <span className="mt-0.5 block text-sm text-muted">{bar.hint}</span>
            </span>
            <span className="inline-flex min-h-11 items-center rounded-[10px] border border-line bg-surface-2 px-4 text-sm font-semibold">Choose files</span>
          </>
        ) : (
          <>
            <span className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
              <Icon name="upload" className="size-6" />
            </span>
            <span className="text-sm">
              Drop {noun} here or <span className="font-medium text-accent-ink underline">choose {noun}</span>
              <span className="mt-1 block text-muted">They are opened on this device, not uploaded.</span>
            </span>
          </>
        )}
        <input
          type="file"
          className="sr-only"
          multiple={multiple}
          accept={accept.join(',')}
          onChange={(e) => { take(e.target.files); e.target.value = '' }}
        />
      </label>
      {skipped > 0 && (
        <p role="status" className="mt-2 text-sm text-muted">
          {skipped === 1 ? '1 file was' : `${skipped} files were`} skipped because this tool can't use {skipped === 1 ? 'it' : 'them'}.
        </p>
      )}
    </div>
  )
}
