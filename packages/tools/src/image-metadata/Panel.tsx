import { useEffect, useState } from 'react'
import { Icon } from '@ream/ui'
import type { MetadataSummary } from '@ream/image-core'
import type { PanelProps } from '../panels.ts'
import { defaultOptions, type ImageMetadataOptions as O } from './options.ts'

export { defaultOptions }

type Loaded = { file: File; info: MetadataSummary | null | 'failed' }

const MODES: { value: O['mode']; title: string; note: string }[] = [
  { value: 'all', title: 'Remove everything', note: 'Camera, dates, location, text and editing details. The colour profile stays, and so does the orientation if the photo was taken sideways.' },
  { value: 'location', title: 'Remove location only', note: 'Takes out where it was taken and the small preview picture. Camera and date stay. Place names typed into a caption are not touched.' },
]

export function Panel({ options, onChange, files, readImageMetadata }: PanelProps<O>) {
  const [loaded, setLoaded] = useState<Loaded[]>([])
  useEffect(() => {
    onChange(defaultOptions)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    let live = true
    setLoaded(files.map((file) => ({ file, info: null })))
    if (!readImageMetadata) return
    files.forEach((file, i) =>
      readImageMetadata(file).then(
        (info) => live && setLoaded((l) => l.map((x, j) => (j === i ? { file, info: info ?? 'failed' } : x))),
        () => live && setLoaded((l) => l.map((x, j) => (j === i ? { file, info: 'failed' } : x))),
      ),
    )
    return () => {
      live = false
    }
  }, [files, readImageMetadata])

  if (!files.length) return <p className="text-sm text-muted">Add JPG or PNG photos to see what they say about themselves.</p>

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">What to remove</legend>
        {MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-2 text-sm">
            <input type="radio" name="metadata-mode" checked={options.mode === m.value} onChange={() => onChange({ mode: m.value })} className="mt-0.5" />
            <span>
              {m.title}
              <span className="block text-xs text-muted">{m.note}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-muted">The picture itself is not touched, so there is no loss of quality.</p>
      </fieldset>

      <section aria-label="What the files contain" className="space-y-2">
        <h3 className="text-sm font-medium">What the {files.length === 1 ? 'file contains' : 'files contain'}</h3>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {loaded.map(({ file, info }, i) => (
            <li key={`${file.name}-${i}`} className="p-3 text-sm">
              <FileSummary file={file} info={info} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function FileSummary({ file, info }: Loaded) {
  const found = info && info !== 'failed' ? info : null
  const empty = found && !found.groups.length && !found.extras.length
  return (
    <details open={!!found && !empty && found.location}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
        {info === null && <span className="text-xs text-muted">Reading…</span>}
        {info === 'failed' && <span className="text-xs text-muted">Can't read this file</span>}
        {empty && <span className="text-xs text-muted">Nothing to remove</span>}
        {found && found.location && (
          <span className="inline-flex items-center gap-1 rounded-md bg-warning-soft px-2 py-0.5 text-xs text-warning">
            <Icon name="alert" className="size-3.5" />
            Includes location
          </span>
        )}
      </summary>
      {found && !empty && (
        <div className="mt-3 space-y-3">
          {found.groups.map((g) => (
            <div key={g.title}>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{g.title}</h4>
              <dl className="grid grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] gap-x-4 gap-y-0.5">
                {g.fields.map((f, k) => (
                  <div key={`${f.label}-${k}`} className="contents">
                    <dt className="text-muted">{f.label}</dt>
                    <dd className="min-w-0 wrap-break-word">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          {found.extras.length > 0 && (
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Also stored</h4>
              <ul className="list-inside list-disc text-muted">
                {found.extras.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </details>
  )
}
