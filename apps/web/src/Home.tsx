import { useState } from 'react'
import { Dropzone, Icon } from '@ream/ui'
import { tools } from '@ream/tools'
import { acceptsFile, type Category, type Tool } from '@ream/core'
import { setHandoff } from './handoff'

const chips: { label: string; value: Category | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'PDF', value: 'pdf' },
  { label: 'Image', value: 'image' },
]
const titles: Record<Category, string> = { pdf: 'PDF tools', image: 'Image tools' }
const tint: Record<Category, string> = { pdf: 'bg-cat-pdf-soft text-cat-pdf', image: 'bg-cat-image-soft text-cat-image' }

const accepted = [...new Set(tools.filter((t) => t.status === 'ready').flatMap((t) => t.accept))]
const focus = 'focus-visible:outline-2 focus-visible:outline-accent'

export function Home() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [dropped, setDropped] = useState<File[]>([])
  const needle = q.trim().toLowerCase()
  const shown = tools.filter((t) => (cat === 'all' || t.category === cat) && (t.title + ' ' + t.description).toLowerCase().includes(needle))

  // with files dropped, the tools that can take all of them come first and the rest are dimmed
  const fits = (t: Tool) => t.status === 'ready' && dropped.every((f) => acceptsFile(f, t.accept)) && (t.multiple || dropped.length === 1)
  const sections: { title: string; tools: Tool[]; dim?: boolean }[] = dropped.length
    ? [
        { title: 'Suggested for your files', tools: shown.filter(fits) },
        { title: 'Other tools', tools: shown.filter((t) => !fits(t)), dim: true },
      ]
    : (['pdf', 'image'] as const).map((c) => ({ title: titles[c], tools: shown.filter((t) => t.category === c) }))

  const open = (t: Tool) => {
    setHandoff(dropped)
    location.hash = `#/tool/${t.id}`
  }

  return (
    <>
      <section className="mx-auto mb-10 max-w-2xl text-center">
        <h1 className="text-3xl font-medium tracking-tight">What do you want to do with your files?</h1>
        <p className="mb-6 mt-2 text-sm text-muted">Nothing is uploaded. Everything runs on your device.</p>
        <Dropzone accept={accepted} onFiles={setDropped} />
        {dropped.length > 0 && (
          <p role="status" className="mt-3 flex items-center justify-center gap-3 text-sm">
            <span className="truncate">
              {dropped.length === 1 ? dropped[0].name : `${dropped.length} files ready`}.{' '}
              {tools.some(fits) ? 'Pick a tool below.' : "No single tool takes all of these. Try one type of file at a time."}
            </span>
            <button onClick={() => setDropped([])} className={`rounded-md text-accent-ink underline ${focus}`}>Clear</button>
          </p>
        )}
      </section>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Icon name="search" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tools, e.g. merge, resize"
            aria-label="Search tools"
            className={`w-full rounded-lg border border-field bg-surface py-2 pl-9 pr-3 text-sm placeholder:text-muted ${focus}`}
          />
        </div>
        <div className="flex gap-2" role="group" aria-label="Filter by category">
          {chips.map((c) => (
            <button
              key={c.value}
              onClick={() => setCat(c.value)}
              aria-pressed={cat === c.value}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors duration-150 ${focus} ${cat === c.value ? 'bg-accent text-on-accent' : 'border border-line bg-surface hover:bg-surface-2'}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && <p className="text-sm text-muted">No tools match that search.</p>}
      {sections.filter((s) => s.tools.length).map((s) => (
        <section key={s.title} className="mb-8" aria-label={s.title}>
          <h2 className="mb-3 text-sm font-medium text-muted">{s.title}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {s.tools.map((t) => (
              <ToolCard key={t.id} tool={t} suggested={dropped.length > 0 && !s.dim} dim={s.dim} onOpen={dropped.length ? () => open(t) : undefined} />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function ToolCard({ tool: t, suggested, dim, onOpen }: { tool: Tool; suggested: boolean; dim?: boolean; onOpen?: () => void }) {
  const body = (
    <>
      <span className={`mb-3 flex size-9 items-center justify-center rounded-lg ${tint[t.category]}`}>
        <Icon name={t.icon} className="size-5" />
      </span>
      <span className="block text-sm font-medium">
        {t.title}
        {t.status === 'soon' && <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-normal text-muted">Soon</span>}
      </span>
      <span className="block text-xs text-muted">{t.description}</span>
    </>
  )
  const edge = suggested ? 'border-accent ring-1 ring-accent' : dim ? 'border-line' : 'border-line hover:border-accent'
  const box = `block h-full w-full rounded-xl border bg-surface p-4 text-left transition-colors duration-150 ${edge}`
  if (dim) return <div aria-disabled="true" className={`${box} opacity-50`}>{body}</div>
  if (onOpen) return <button onClick={onOpen} className={`${box} ${focus}`}>{body}</button>
  return <a href={`#/tool/${t.id}`} className={`${box} ${focus}`}>{body}</a>
}
