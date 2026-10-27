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
        className={`flex cursor-pointer border border-dashed transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${over ? 'border-accent bg-accent-soft' : 'border-field hover:bg-ink/4'} ${
          compact
            ? 'items-center justify-center gap-2 px-3 py-2.5 text-sm'
            : bar
              ? 'flex-wrap items-center gap-5 px-6 py-5'
              : 'flex-col items-center justify-center gap-3 px-6 py-12 text-center'
        }`}
      >
        {compact ? (
          <>
            <Icon name="upload" className="size-4 text-accent-ink" />
            <span className="text-accent-ink">{multiple ? 'Add more files' : 'Replace file'}</span>
          </>
        ) : bar ? (
          <>
            <Icon name="upload" className="size-7 shrink-0 text-accent-ink" />
            <span className="min-w-0 flex-[1_1_16rem]">
              <span className="block font-heading text-lg font-semibold">{bar.title}</span>
              <span className="block text-sm text-muted">{bar.hint}</span>
            </span>
            <span className="inline-flex min-h-9 items-center border border-line px-3.5 font-heading text-[15px] font-semibold tracking-wide pointer-coarse:min-h-11">Choose files</span>
          </>
        ) : (
          <>
            <Icon name="upload" className="size-8 text-accent-ink" />
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
