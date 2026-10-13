import { useEffect, useRef, useState } from 'react'
import { Button, Card, Dropzone, Icon } from '@ream/ui'
import { UserError, acceptsFile, formatBytes, type FileData, type Tool } from '@ream/core'
import { tools } from '@ream/tools'
import { panels, type PanelModule } from '@ream/tools/panels'
import { runTool, type Running } from './runtime'
import { download, toFile } from './download'
import { clearHandoff, peekHandoff, setHandoff } from './handoff'
import { FileMeta, Thumb } from './Thumb'
import { Preview } from './Preview'
import { usePreview } from './usePreview'

type State =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number }
  | { kind: 'done'; outputs: FileData[] }
  | { kind: 'error'; message: string }

const GENERIC = 'Something went wrong while processing your files. Nothing was uploaded. Try again, or try a different file.'

export function ToolPage({ tool }: { tool?: Tool }) {
  const [files, setFiles] = useState<File[]>(() => (tool ? peekHandoff().filter((f) => acceptsFile(f, tool.accept)) : []))
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [panel, setPanel] = useState<PanelModule | null>(null)
  const [options, setOptions] = useState<unknown>(null)
  const [active, setActive] = useState(0)
  const job = useRef<Running | null>(null)
  const showPreview = !!tool && tool.status === 'ready' && tool.preview !== 'none'
  const preview = usePreview(tool, files, options, showPreview && state.kind !== 'running')

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

  return (
    <>
      {back}
      <h1 className="text-xl font-semibold">{tool.title}</h1>
      <p className="mb-4 text-sm text-muted">{tool.description}</p>

      <div className={showPreview ? 'lg:grid lg:grid-cols-2 lg:items-start lg:gap-6' : ''}>
      <div className="min-w-0">
      <Dropzone
        accept={tool.accept}
        multiple={tool.multiple}
        onFiles={(added) => changeFiles(tool.multiple ? [...files, ...added] : added)}
      />

      {files.length > 0 && (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className={`flex items-center gap-2 px-3 py-2 text-sm ${showPreview && i === active ? 'bg-accent-soft' : ''}`}>
              <button
                onClick={() => setActive(i)}
                aria-label={`Preview ${f.name}`}
                aria-current={showPreview && i === active ? 'true' : undefined}
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

      <Card className="mt-4 space-y-4">
        {soon ? (
          <p className="text-sm text-muted">This tool isn't built yet. Files you add here stay in your browser and nothing runs.</p>
        ) : (
          <>
            {panel && options !== null && <panel.Panel options={options} onChange={setOptions} files={files} />}
            {running ? (
              <Progress value={state.progress} onCancel={cancel} />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={run} disabled={missing > 0}>{tool.action}</Button>
                {missing > 0 && (
                  <span className="text-sm text-muted">
                    {files.length === 0 ? `Add ${tool.minFiles === 1 ? 'a file' : `at least ${tool.minFiles} files`} to start.` : `Add ${missing} more ${missing === 1 ? 'file' : 'files'} to start.`}
                  </span>
                )}
              </div>
            )}
          </>
        )}
        {state.kind === 'error' && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-accent" />
            {state.message}
          </p>
        )}
      </Card>

      {state.kind === 'done' && <Result tool={tool} outputs={state.outputs} onReset={() => changeFiles([])} />}
      </div>
      {showPreview && (
        <aside className="mt-4 min-w-0 lg:sticky lg:top-4 lg:mt-0">
          <Preview tool={tool} files={files} active={active} preview={preview.state} onRefresh={preview.refresh} />
        </aside>
      )}
      </div>
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
    <Card className="mt-4 space-y-4" aria-label="Result">
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
