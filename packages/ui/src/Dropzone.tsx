import { useState } from 'react'
import { Icon } from './Icon'

const matches = (f: File, accept: string[]) =>
  accept.some((a) =>
    a.startsWith('.') ? f.name.toLowerCase().endsWith(a) : a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : f.type === a,
  )

type Props = { accept: string[]; multiple?: boolean; onFiles: (files: File[]) => void }

export function Dropzone({ accept, multiple = true, onFiles }: Props) {
  const [over, setOver] = useState(false)
  const take = (list: FileList | null) => {
    // drag-and-drop ignores the input's accept attribute, so filter here too
    const files = Array.from(list ?? []).filter((f) => matches(f, accept))
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}
      className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-10 text-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${over ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
    >
      <Icon name="upload" className="size-6 text-muted" />
      <span className="text-sm">
        Drop files here or <span className="text-accent underline">choose files</span>
      </span>
      <input
        type="file"
        className="sr-only"
        multiple={multiple}
        accept={accept.join(',')}
        onChange={(e) => { take(e.target.files); e.target.value = '' }}
      />
    </label>
  )
}
