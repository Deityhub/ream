import { useState } from 'react'
import { acceptsFile } from '@ream/core'
import { Icon } from './Icon.tsx'

type Props = {
  accept: string[]
  multiple?: boolean
  onFiles: (files: File[]) => void
  /** a slim "add more" bar instead of the big drop area */
  compact?: boolean
}

export function Dropzone({ accept, multiple = true, onFiles, compact = false }: Props) {
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
        className={`flex cursor-pointer items-center border-dashed text-center transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${over ? 'border-accent bg-accent-soft' : 'border-field bg-surface hover:bg-accent-soft'} ${
          compact ? 'justify-center gap-2 rounded-lg border px-3 py-2 text-sm' : 'flex-col justify-center gap-3 rounded-2xl border-2 px-6 py-12'
        }`}
      >
        {compact ? (
          <>
            <Icon name="upload" className="size-4 text-accent-ink" />
            <span className="text-accent-ink">{multiple ? 'Add more files' : 'Replace file'}</span>
          </>
        ) : (
          <>
            <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
              <Icon name="upload" className="size-6" />
            </span>
            <span className="text-sm">
              Drop {noun} here or <span className="font-medium text-accent-ink underline">choose {noun}</span>
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
