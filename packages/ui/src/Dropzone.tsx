import { useState } from 'react'
import { acceptsFile } from '@ream/core'
import { Icon } from './Icon.tsx'

type Props = { accept: string[]; multiple?: boolean; onFiles: (files: File[]) => void }

export function Dropzone({ accept, multiple = true, onFiles }: Props) {
  const [over, setOver] = useState(false)
  const [skipped, setSkipped] = useState(0)
  const take = (list: FileList | null) => {
    // drag-and-drop ignores the input's accept attribute, so filter here too
    const all = Array.from(list ?? [])
    const files = all.filter((f) => acceptsFile(f, accept))
    setSkipped(all.length - files.length)
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }
  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-10 text-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${over ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
      >
        <Icon name="upload" className="size-6 text-muted" />
        <span className="text-sm">
          Drop {multiple ? 'files' : 'a file'} here or <span className="text-accent underline">choose {multiple ? 'files' : 'a file'}</span>
        </span>
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
