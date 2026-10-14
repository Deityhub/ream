import { useEffect, useRef, useState } from 'react'
import { Button, Card, Dropzone, Icon } from '@ream/ui'
import { UserError, acceptsFile, formatBytes, type FileData, type Tool } from '@ream/core'
import { tools } from '@ream/tools'
import { panels, type PanelModule } from '@ream/tools/panels'
import { runTool, type Running } from './runtime'
import { download, toFile } from './download'
import { clearHandoff, peekHandoff, setHandoff } from './handoff'
import { FileMeta, Thumb } from './Thumb'
import { PasswordDialog } from './PasswordDialog'
import { inspectPdf, markUnlocked, readImageMetadata, readPdfMetadata, unlockPdf } from './previewClient'
import { isPdf } from './usePdfInfo'
import { Preview } from './Preview'
import { PdfPage } from './PdfPage'
import { usePreview } from './usePreview'

type State =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number }
  | { kind: 'done'; outputs: FileData[] }
  | { kind: 'error'; message: string }

// what option panels may ask of the app (kept outside the component so its identity is stable)
const pdfHost = {
  pages: async (file: File) => {
    const info = await inspectPdf(file)
    if (info.kind !== 'ok') throw new Error('unreadable')
    return info.pages
  },
  PdfPage,
}

const GENERIC = 'Something went wrong while processing your files. Nothing was uploaded. Try again, or try a different file.'

export function ToolPage({ tool }: { tool?: Tool }) {
  const [files, setFiles] = useState<File[]>(() => (tool ? peekHandoff().filter((f) => acceptsFile(f, tool.accept)) : []))
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [panel, setPanel] = useState<PanelModule | null>(null)
  const [options, setOptions] = useState<unknown>(null)
  const [active, setActive] = useState(0)
  const job = useRef<Running | null>(null)
  const showPreview = !!tool && tool.status === 'ready' && tool.preview !== 'none'
  // password protected PDFs found among the files, in the order they were added
  const [locked, setLocked] = useState<File[]>([])
  const waiting = files.filter((f) => locked.includes(f)) // in the order the files are listed, not the order they were inspected
  const asking = waiting[0]
  const preview = usePreview(tool, files, options, showPreview && state.kind !== 'running' && !asking)

  useEffect(() => {
    let live = true
    for (const f of files.filter(isPdf)) {
      inspectPdf(f).then(
        (info) => live && info.kind === 'encrypted' && setLocked((l) => (l.includes(f) ? l : [...l, f])),
        () => {},
      )
    }
    return () => {
      live = false
    }
  }, [files])

  useEffect(() => {
    clearHandoff()
    if (!tool || tool.status === 'soon' || !panels[tool.id]) return
    let live = true
    panels[tool.id]().then((m) => {
      if (!live) return
      setPanel(m)
      setOptions(m.defaultOptions)
    })
    return () => {
      live = false
      job.current?.cancel()
    }
  }, [tool])

  const back = (
    <a href="#/" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
      <Icon name="arrow-left" className="size-4" /> All tools
    </a>
  )
  if (!tool) {
    return (
      <>
        {back}
        <p className="text-sm">That tool doesn't exist.</p>
      </>
    )
  }

  const changeFiles = (next: File[]) => {
    setFiles(next)
    setActive((a) => Math.min(a, Math.max(0, next.length - 1)))
    setState({ kind: 'idle' })
  }
  const move = (i: number, by: number) => {
    const next = [...files]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    changeFiles(next)
    setActive(active === i ? i + by : active === i + by ? i : active)
  }

  /** try a password; on success the locked file is swapped for a decrypted in-memory copy (the original File is untouched) */
  const tryUnlock = async (file: File, password: string): Promise<string | null> => {
    const r = await unlockPdf(file, password)
    if (r.kind === 'wrong') return password ? "That password isn't right. Try again." : 'Enter the password to open this PDF.'
    if (r.kind === 'error') return r.message
    const copy = new File([r.bytes as BlobPart], file.name, { type: 'application/pdf' })
    markUnlocked(copy)
    setFiles((fs) => fs.map((f) => (f === file ? copy : f)))
    setState({ kind: 'idle' })
    return null
  }

  const run = () => {
    // a live preview that is up to date already is the result: no need to run the engine twice
    if (preview.state.kind === 'ready' && !preview.state.stale) {
      setState({ kind: 'done', outputs: preview.state.outputs })
      return
    }
    setState({ kind: 'running', progress: 0 })
    const j = runTool(tool.id, files, options, (progress) => setState((s) => (s.kind === 'running' ? { kind: 'running', progress } : s)))
    job.current = j
    j.promise.then(
      (outputs) => setState({ kind: 'done', outputs }),
      (e) => {
        if (e?.name === 'AbortError') return
        if (!(e instanceof UserError)) console.error(e)
        setState({ kind: 'error', message: e instanceof UserError ? e.message : GENERIC })
      },
    )
  }
  const cancel = () => {
    job.current?.cancel()
    setState({ kind: 'idle' })
  }

  const soon = tool.status === 'soon'
  const missing = tool.minFiles - files.length
  const running = state.kind === 'running'

  const empty = files.length === 0
  // three regions at xl (files | preview | options), two at lg, stacked below; tools without a preview (crop) keep the options wide
  const grid = empty
    ? 'mx-auto max-w-2xl'
    : showPreview
      ? 'grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] xl:grid-cols-[18rem_minmax(0,1fr)_18rem]'
      : 'grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]'
  const railPos = empty ? '' : 'lg:col-start-1 lg:row-start-1'
  const optionsPos = showPreview ? 'order-2 lg:col-start-1 lg:row-start-2 xl:order-3 xl:col-start-3 xl:row-start-1' : 'lg:col-start-2 lg:row-start-1 lg:row-span-2'
  const canvasPos = 'order-3 lg:col-start-2 lg:row-start-1 lg:row-span-2 xl:order-2 xl:row-span-1'

  return (
    <>
      {back}
      <h1 className="text-2xl font-medium tracking-tight">{tool.title}</h1>
      <p className="mb-6 text-sm text-muted">{tool.description}</p>

      <div className={`${grid} items-start`}>
        <div className={`min-w-0 space-y-3 ${railPos}`}>
          <Dropzone
            accept={tool.accept}
            multiple={tool.multiple}
            compact={!empty}
            onFiles={(added) => changeFiles(tool.multiple ? [...files, ...added] : added)}
          />
          {!empty && (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className={`flex items-center gap-1 px-3 py-2 text-sm ${showPreview && i === active ? 'bg-accent-soft' : ''}`}>
                  <button
                    onClick={() => setActive(i)}
                    aria-label={`Preview ${f.name}`}
                    aria-current={showPreview && i === active ? 'true' : undefined}
                    title={f.name}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <Thumb file={f} />
                    <span className="min-w-0">
                      <span className="block truncate">{f.name}</span>
                      <FileMeta file={f} />
                    </span>
                  </button>
                  {tool.multiple && files.length > 1 && (
                    <>
                      <IconButton label={`Move ${f.name} up`} icon="arrow-up" disabled={i === 0 || running} onClick={() => move(i, -1)} />
                      <IconButton label={`Move ${f.name} down`} icon="arrow-down" disabled={i === files.length - 1 || running} onClick={() => move(i, 1)} />
                    </>
                  )}
                  <IconButton label={`Remove ${f.name}`} icon="x" disabled={running} onClick={() => changeFiles(files.filter((_, j) => j !== i))} />
                </li>
              ))}
            </ul>
          )}
          {empty && soon && <p className="mt-3 text-sm text-muted">This tool isn't built yet. Files you add here stay in your browser and nothing runs.</p>}
        </div>

        {!empty && (
          <div className={`min-w-0 space-y-4 ${optionsPos}`}>
            <Card className="space-y-4">
              {soon ? (
                <p className="text-sm text-muted">This tool isn't built yet. Files you add here stay in your browser and nothing runs.</p>
              ) : (
                <>
                  {panel && options !== null && <panel.Panel options={options} onChange={setOptions} files={files} readMetadata={readPdfMetadata} readImageMetadata={readImageMetadata} pdfHost={pdfHost} />}
                  {running ? (
                    <Progress value={state.progress} onCancel={cancel} />
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button onClick={run} disabled={missing > 0 || !!asking}>{tool.action}</Button>
                      {asking && <span className="text-sm text-muted">Unlock {asking.name} to continue, or skip it.</span>}
                      {!asking && missing > 0 && (
                        <span className="text-sm text-muted">
                          {files.length === 0 ? `Add ${tool.minFiles === 1 ? 'a file' : `at least ${tool.minFiles} files`} to start.` : `Add ${missing} more ${missing === 1 ? 'file' : 'files'} to start.`}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
              {state.kind === 'error' && (
                <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                  <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
                  {state.message}
                </p>
              )}
            </Card>
            {state.kind === 'done' && <Result tool={tool} outputs={state.outputs} onReset={() => changeFiles([])} />}
          </div>
        )}

        {!empty && showPreview && (
          <aside className={`min-w-0 xl:sticky xl:top-4 ${canvasPos}`}>
            <Preview tool={tool} files={files} active={active} preview={preview.state} onRefresh={preview.refresh} />
          </aside>
        )}
      </div>
      {asking && (
        <PasswordDialog
          key={`${asking.name}-${asking.size}-${asking.lastModified}`}
          name={asking.name}
          others={waiting.length - 1}
          onSubmit={(pw) => tryUnlock(asking, pw)}
          onSkip={() => changeFiles(files.filter((f) => f !== asking))}
        />
      )}
    </>
  )
}

function IconButton({ label, icon, disabled, onClick }: { label: string; icon: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded p-1 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon name={icon} className="size-4" />
    </button>
  )
}

function Progress({ value, onCancel }: { value: number; onCancel: () => void }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-3">
      <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span role="status" className="w-10 text-right text-sm text-muted">{pct}%</span>
      <Button variant="secondary" onClick={onCancel}>Cancel</Button>
    </div>
  )
}

function Result({ tool, outputs, onReset }: { tool: Tool; outputs: FileData[]; onReset: () => void }) {
  const next = tools.filter(
    (t) => t.id !== tool.id && t.status === 'ready' && outputs.every((o) => acceptsFile(o, t.accept)) && (t.multiple || outputs.length === 1),
  )
  const total = outputs.reduce((n, o) => n + o.bytes.length, 0)
  return (
    <Card className="space-y-4" aria-label="Result">
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        <Icon name="check" className="size-4 text-accent" />
        Done: {outputs.length} {outputs.length === 1 ? 'file' : 'files'}, {formatBytes(total)}
      </p>
      <ul className="divide-y divide-line rounded-lg border border-line text-sm">
        {outputs.map((o, i) => (
          <li key={i} className="flex gap-3 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            <span className="text-xs text-muted">{formatBytes(o.bytes.length)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => download(outputs)}>
          <Icon name="download" className="size-4" /> {outputs.length > 1 ? 'Download ZIP' : 'Download'}
        </Button>
        <Button variant="secondary" onClick={onReset}>Start over</Button>
      </div>
      {next.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Use in another tool:</span>
          {next.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setHandoff(outputs.map(toFile))
                location.hash = `#/tool/${t.id}`
              }}
              className="rounded-full border border-line bg-surface px-3 py-1 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t.title}
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}
