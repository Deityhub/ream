import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Icon } from '@ream/ui'
import { formatBytes, type FileData, type Tool } from '@ream/core'
import type { PreviewState } from './previewController'
import { toFile } from './download'
import { useObjectUrl } from './Thumb'
import { isPdf, pageCount, usePdfInfo } from './usePdfInfo'
import { LazyPdfPage } from './PdfPage'

type Props = {
  tool: Tool
  files: File[]
  active: number
  preview: PreviewState
  onRefresh: () => void
}

/** Right-hand panel: the file being worked on ("Original") and what the tool would produce ("Result"). */
export function Preview({ tool, files, active, preview, onRefresh }: Props) {
  const [tab, setTab] = useState<'original' | 'result'>('result')
  const hasResult = preview.kind !== 'idle'
  const shown = tab === 'result' && hasResult ? 'result' : 'original'
  const original = files[Math.min(active, files.length - 1)]

  if (!original) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
        Add a file to see a preview here.
      </div>
    )
  }

  const stale = preview.kind === 'ready' && preview.stale
  return (
    <section aria-label="Preview" className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="Preview of" className="inline-flex rounded-lg border border-line p-0.5 text-sm">
          {(['original', 'result'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={shown === t}
              disabled={t === 'result' && !hasResult}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 capitalize focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${shown === t ? 'bg-accent text-on-accent' : 'hover:bg-surface-2'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {stale && (
          <span role="status" className="text-xs text-muted">
            Updating…
          </span>
        )}
      </div>

      {shown === 'original' ? (
        <FileView file={original} />
      ) : (
        <div aria-busy={stale} className={stale ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <ResultView tool={tool} files={files} preview={preview} onRefresh={onRefresh} />
        </div>
      )}
    </section>
  )
}

function ResultView({ tool, files, preview, onRefresh }: { tool: Tool; files: File[]; preview: PreviewState; onRefresh: () => void }) {
  if (preview.kind === 'pending') return <p className="py-10 text-center text-sm text-muted">Preparing preview…</p>
  if (preview.kind === 'manual') {
    return (
      <div className="space-y-3 py-6 text-center text-sm text-muted">
        <p>These files are large, so the preview only updates when you ask.</p>
        <Button variant="secondary" onClick={onRefresh}>Update preview</Button>
      </div>
    )
  }
  if (preview.kind === 'error') {
    return (
      <p role="status" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        Can't preview yet: {preview.message}
      </p>
    )
  }
  if (preview.kind !== 'ready') return null
  const inputBytes = files.reduce((n, f) => n + f.size, 0)
  return <Outputs outputs={preview.outputs} compareTo={tool.minFiles === 1 && !tool.multiple ? inputBytes : files.length === preview.outputs.length ? inputBytes : undefined} />
}

/** one output shown directly; several (split, batch resize) as a pick list */
function Outputs({ outputs, compareTo }: { outputs: FileData[]; compareTo?: number }) {
  const [sel, setSel] = useState(0)
  const files = useMemo(() => outputs.map(toFile), [outputs])
  const current = files[Math.min(sel, files.length - 1)]
  const single = outputs.length === 1
  const total = outputs.reduce((n, o) => n + o.bytes.length, 0)
  return (
    <div className="space-y-3">
      {!single && (
        <ul aria-label="Result files" className="max-h-40 divide-y divide-line overflow-auto rounded-lg border border-line text-sm">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <button
                onClick={() => setSel(i)}
                aria-pressed={i === sel}
                className={`flex w-full items-center gap-3 px-3 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-accent ${i === sel ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
              >
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted">{formatBytes(f.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <FileView file={current} was={single && compareTo !== undefined ? compareTo : undefined} />
      {!single && <p className="text-xs text-muted">{outputs.length} files, {formatBytes(total)} in total</p>}
    </div>
  )
}

/** a picture, or for a PDF its page count and size, with the facts under it */
function FileView({ file, was }: { file: File; was?: number }) {
  return file.type.startsWith('image/') ? <ImageView file={file} was={was} /> : isPdf(file) ? <PdfView file={file} was={was} /> : null
}

function ImageView({ file, was }: { file: File; was?: number }) {
  const url = useObjectUrl(file)
  const [dims, setDims] = useState<string>()
  return (
    <figure className="space-y-2">
      <div className="flex min-h-32 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2 p-3">
        {url && (
          <img
            src={url}
            alt={`Preview of ${file.name}`}
            onLoad={(e) => setDims(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px`)}
            className="checker max-h-[60vh] max-w-full object-contain"
          />
        )}
      </div>
      <Facts name={file.name} parts={[dims, sizeText(file.size, was)]} />
    </figure>
  )
}

/** every page of a PDF, drawn lazily as it scrolls into view, with a note when the drawing is approximate */
function PdfView({ file, was }: { file: File; was?: number }) {
  const info = usePdfInfo(file)
  const [warnings, setWarnings] = useState<string[]>([])
  const noteWarnings = useCallback((w: string[]) => w.length && setWarnings((prev) => [...new Set([...prev, ...w])]), [])
  useEffect(() => setWarnings([]), [file])
  return (
    <figure className="space-y-2">
      {info === 'loading' && <p className="rounded-lg border border-line bg-surface-2 p-6 text-center text-sm text-muted">Reading…</p>}
      {info !== 'loading' && info.kind === 'error' && <p className="rounded-lg border border-line bg-surface-2 p-6 text-center text-sm">{info.message}</p>}
      {info !== 'loading' && info.kind === 'encrypted' && <p className="rounded-lg border border-line bg-surface-2 p-6 text-center text-sm">This PDF is password protected.</p>}
      {info !== 'loading' && info.kind === 'ok' && (
        <div className="max-h-[70vh] space-y-3 overflow-auto rounded-lg border border-line bg-surface-2 p-3">
          {info.pages.map((size, i) => (
            <LazyPdfPage key={i} file={file} page={i} size={size} renderWidth={PAGE_WIDTH} onWarnings={noteWarnings} />
          ))}
        </div>
      )}
      {warnings.length > 0 && <p className="rounded-md bg-warning-soft px-2 py-1 text-xs text-warning">Preview is approximate: {warnings.join('; ').replace(/^./, (c) => c.toLowerCase())}.</p>}
      <Facts name={file.name} parts={[pageCount(info) ?? undefined, sizeText(file.size, was)]} />
    </figure>
  )
}

const PAGE_WIDTH = 800

const sizeText = (size: number, was?: number) => (was !== undefined && was !== size ? `${formatBytes(size)} (was ${formatBytes(was)})` : formatBytes(size))

function Facts({ name, parts }: { name: string; parts: (string | undefined)[] }) {
  return (
    <figcaption className="text-sm">
      <span className="font-medium">{name}</span>
      <span className="text-muted"> · {parts.filter(Boolean).join(' · ')}</span>
    </figcaption>
  )
}
