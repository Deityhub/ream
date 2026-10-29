import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { Button, Card, Dropzone, Icon } from '@ream/ui'
import { UserError, acceptsFile, formatBytes, type FileData, type Tool } from '@ream/core'
import { tools } from '@ream/tools'
import { panels, type PanelModule } from '@ream/tools/panels'
import { runTool, warmTool, type Running } from './runtime'
import { download, toFile } from './download'
import { clearHandoff, peekHandoff, setHandoff } from './handoff'
import { FileMeta, Thumb } from './Thumb'
import { PasswordDialog } from './PasswordDialog'
import { inspectPdf, markUnlocked, readFontFile, readImageMetadata, readOfficeFonts, readPdfMetadata, readPdfOutline, readPdfForm, readPdfChars, readPdfLayout, readPdfContent, readPdfFonts, unlockPdf } from './previewClient'
import { isPdf } from './usePdfInfo'
import { Preview } from './Preview'
import { SizeEstimate } from './SizeEstimate'
import { LazyPdfPage, PdfPage } from './PdfPage'
import { usePreview } from './usePreview'
import { Breadcrumb, TopBar, focus } from './TopBar'
import { Link, navigate } from './router'
import { toolPath } from './routes'

// the page's words (what it does, questions, more tools) load after the tool itself
const ToolAbout = lazy(() => import('./ToolAbout').then((m) => ({ default: m.ToolAbout })))

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
  outline: readPdfOutline,
  form: readPdfForm,
  chars: readPdfChars,
  layout: readPdfLayout,
  content: readPdfContent,
  fonts: readPdfFonts,
  check: async (file: File) => {
    const info = await inspectPdf(file)
    return info.kind === 'ok' ? { ok: true, pages: info.pages.length, rebuilt: info.rebuilt } : { ok: false, pages: 0, rebuilt: false, message: info.kind === 'error' ? info.message : undefined }
  },
  PdfPage,
  LazyPage: LazyPdfPage,
}

const GENERIC = 'Something went wrong while processing your files. Nothing was uploaded. Try again, or try a different file.'

export function ToolPage({ tool }: { tool?: Tool }) {
  const [files, setFiles] = useState<File[]>(() => (tool ? peekHandoff().filter((f) => acceptsFile(f, tool.accept)) : []))
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [panel, setPanel] = useState<PanelModule | null>(null)
  const [options, setOptions] = useState<unknown>(null)
  const [active, setActive] = useState(0)
  const job = useRef<Running | null>(null)
  // the preview pane; tools whose preview is only the new size (compress) run it too, and show the size beside the options
  const showPreview = !!tool && tool.status === 'ready' && (tool.preview === 'live' || tool.preview === 'manual')
  const sizeOnly = !!tool && tool.status === 'ready' && tool.preview === 'size'
  // password protected PDFs found among the files, in the order they were added
  const [locked, setLocked] = useState<File[]>([])
  const waiting = files.filter((f) => locked.includes(f)) // in the order the files are listed, not the order they were inspected
  const asking = waiting[0]
  const preview = usePreview(tool, files, options, (showPreview || sizeOnly) && state.kind !== 'running' && !asking)

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
    warmTool(tool.id)
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

  if (!tool) {
    return (
      <>
        <TopBar />
        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8">
          <Breadcrumb cat="all" />
          <p className="text-[15px]">That tool doesn't exist. <Link to="/tools/" className={`font-semibold text-accent-ink underline ${focus}`}>See all tools</Link>.</p>
        </main>
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
  // files | preview | options at xl. At lg the options stay on the right and the files sit above the preview. Tools without a
  // preview (crop, sign) have the page or picture in their own panel, with their controls and the button on its right.
  // Stacked (small screens), the options come before the preview so they are not missed.
  const grid = empty
    ? 'mx-auto max-w-2xl'
    : showPreview
      ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[20rem_minmax(0,1fr)_18rem] 2xl:grid-cols-[22rem_minmax(0,1fr)_22rem]'
      : panel?.placesActions
        ? 'grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] 2xl:grid-cols-[22rem_minmax(0,1fr)]'
        : // no preview and no surface of its own (metadata, compress): the options card stays a readable width
          'grid gap-6 lg:grid-cols-[18rem_minmax(0,40rem)] 2xl:grid-cols-[22rem_minmax(0,44rem)]'
  const railPos = empty ? '' : showPreview ? 'lg:col-start-1 lg:row-start-1' : 'lg:col-start-1 lg:row-start-1'
  const optionsPos = showPreview ? 'order-2 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-4 xl:order-3 xl:col-start-3 xl:row-span-1' : 'lg:col-start-2 lg:row-start-1 lg:row-span-2'
  const canvasPos = 'order-3 lg:col-start-1 lg:row-start-2 xl:col-start-2 xl:row-start-1 xl:order-2'

  // the run button with its progress, hints and the error from the last run
  const actionBar = (
    <div className="space-y-3">
      {running ? (
        <Progress value={state.progress} onCancel={cancel} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" className="w-full" onClick={run} disabled={missing > 0 || !!asking}>{tool.action}</Button>
          {asking && <span className="text-sm text-muted">Unlock {asking.name} to continue, or skip it.</span>}
          {!asking && missing > 0 && (
            <span className="text-sm text-muted">
              {files.length === 0 ? `Add ${tool.minFiles === 1 ? 'a file' : `at least ${tool.minFiles} files`} to start.` : `Add ${missing} more ${missing === 1 ? 'file' : 'files'} to start.`}
            </span>
          )}
        </div>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      )}
    </div>
  )

  const panelBody =
    panel && options !== null ? (
      <panel.Panel options={options} onChange={setOptions} files={files} readMetadata={readPdfMetadata} readImageMetadata={readImageMetadata} readOfficeFonts={readOfficeFonts} readFontFile={readFontFile} pdfHost={pdfHost} actions={panel.placesActions ? actionBar : undefined} />
    ) : null

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-[1600px] px-4 pb-14 pt-6 sm:px-8">
      <Breadcrumb cat={tool.category} tool={tool} />
      {/* the breadcrumb shows the name; the heading is kept for screen readers */}
      <h1 className="sr-only">{tool.title}</h1>

      <div className={`${grid} items-start`}>
        <div className={`min-w-0 space-y-3 ${railPos}`}>
          <Dropzone
            accept={tool.accept}
            multiple={tool.multiple}
            compact={!empty}
            onFiles={(added) => changeFiles(tool.multiple ? [...files, ...added] : added)}
          />
          {!empty && (
            <ul className="space-y-2 overflow-auto lg:max-h-72 xl:max-h-none">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className={`flex items-center gap-1 border px-3 py-2.5 text-sm ${showPreview && i === active ? 'border-accent-2 bg-accent-soft' : 'border-line'}`}>
                  {tool.multiple && files.length > 1 && <span className="w-6 shrink-0 text-[13px] font-semibold tabular-nums tracking-widest text-accent-ink">{String(i + 1).padStart(2, '0')}</span>}
                  <button
                    onClick={() => setActive(i)}
                    aria-label={`Preview ${f.name}`}
                    aria-current={showPreview && i === active ? 'true' : undefined}
                    title={f.name}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <Thumb file={f} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{f.name}</span>
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
            {panel?.placesActions && !soon ? (
              // a tool with its own surface lays out its own cards (surface, controls) in the same grid
              panelBody
            ) : (
              <Card className="space-y-5 p-5">
              {soon ? (
                <p className="text-sm text-muted">This tool isn't built yet. Files you add here stay in your browser and nothing runs.</p>
              ) : (
                <>
                  {panelBody}
                  {sizeOnly && files.length >= tool.minFiles && !asking && <SizeEstimate files={files} preview={preview.state} onRefresh={preview.refresh} />}
                  {actionBar}
                </>
              )}
              </Card>
            )}
          </div>
        )}

        {!empty && showPreview && (
          <aside className={`min-w-0 ${canvasPos}`}>
            <Preview tool={tool} files={files} active={active} preview={preview.state} onRefresh={preview.refresh} />
          </aside>
        )}
      </div>
      <Suspense fallback={null}>
        <ToolAbout tool={tool} />
      </Suspense>
      </main>
      {state.kind === 'done' && <ResultDialog tool={tool} outputs={state.outputs} onClose={() => setState({ kind: 'idle' })} onReset={() => changeFiles([])} />}
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
      className="flex size-8 shrink-0 items-center justify-center text-ink hover:bg-ink/7 pointer-coarse:size-11 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon name={icon} className="size-4.5" />
    </button>
  )
}

function Progress({ value, onCancel }: { value: number; onCancel: () => void }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-3">
      <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 flex-1 overflow-hidden bg-surface-2">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span role="status" className="w-10 text-right text-sm text-muted">{pct}%</span>
      <Button variant="secondary" onClick={onCancel}>Cancel</Button>
    </div>
  )
}

/** The finished files in a popup: download them, start over, or carry them into another tool. Closing it goes back to the options. */
function ResultDialog({ tool, outputs, onClose, onReset }: { tool: Tool; outputs: FileData[]; onClose: () => void; onReset: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const next = tools.filter(
    (t) => t.id !== tool.id && t.status === 'ready' && outputs.every((o) => acceptsFile(o, t.accept)) && (t.multiple || outputs.length === 1),
  )
  const total = outputs.reduce((n, o) => n + o.bytes.length, 0)

  useEffect(() => {
    const d = dialog.current!
    if (!d.open) d.showModal()
    return () => {
      if (d.open) d.close()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      // a click on the dimmed area (the dialog element itself, outside its padded content) closes it
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-[min(32rem,92vw)] border border-line bg-canvas p-0 text-ink shadow-lg backdrop:bg-black/50"
    >
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} role="status" className="flex flex-1 items-center gap-3 border border-success/40 bg-success-soft px-4 py-3 text-2xl">
            <Icon name="check" className="size-5 shrink-0 text-success" />
            <span>
              Done on this device
              <span className="block font-sans text-[13px] font-normal tracking-normal tabular-nums text-muted">{outputs.length} {outputs.length === 1 ? 'file' : 'files'}, {formatBytes(total)}</span>
            </span>
          </h2>
          <button onClick={onClose} aria-label="Close" className="-m-1 p-1 hover:bg-ink/7 focus-visible:outline-2 focus-visible:outline-accent">
            <Icon name="x" className="size-5" />
          </button>
        </div>
        <ul className="max-h-60 divide-y divide-line overflow-auto border border-line text-sm">
          {outputs.map((o, i) => (
            <li key={i} className="flex gap-3 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <span className="text-xs tabular-nums text-muted">{formatBytes(o.bytes.length)}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button autoFocus onClick={() => download(outputs)}>
            <Icon name="download" className="size-4" /> {outputs.length > 1 ? 'Download ZIP' : 'Download'}
          </Button>
          <Button variant="secondary" onClick={onClose}>Keep editing</Button>
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
                  navigate(toolPath(t.id))
                }}
                className="border border-line px-2.5 py-1 hover:bg-ink/7 focus-visible:outline-2 focus-visible:outline-accent"
              >
                {t.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </dialog>
  )
}
