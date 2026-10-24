import { useState } from 'react'
import { Dropzone, Icon } from '@ream/ui'
import { tools } from '@ream/tools'
import { acceptsFile, type Category, type Tool } from '@ream/core'
import { setHandoff } from './handoff'
import { Breadcrumb, TopBar, filterHref, focus, type Filter } from './TopBar'

const ready = tools.filter((t) => t.status === 'ready')
const heads: Record<Filter, string> = { all: 'All tools', pdf: 'PDF tools', image: 'Image tools' }
const titles: Record<Category, string> = { pdf: 'PDF tools', image: 'Image tools' }

const accepted = [...new Set(ready.flatMap((t) => t.accept))]

export function Home({ cat }: { cat: Filter }) {
  const [q, setQ] = useState('')
  const [dropped, setDropped] = useState<File[]>([])
  const needle = q.trim().toLowerCase()
  const shown = tools.filter((t) => (cat === 'all' || t.category === cat) && (t.title + ' ' + t.description).toLowerCase().includes(needle))
  const head = heads[cat]

  // with files dropped, the tools that can take all of them come first and the rest are dimmed
  const fits = (t: Tool) => t.status === 'ready' && dropped.every((f) => acceptsFile(f, t.accept)) && (t.multiple || dropped.length === 1)
  const sections: { title?: string; href?: string; tools: Tool[]; dim?: boolean }[] = dropped.length
    ? [
        { title: 'Suggested for your files', tools: shown.filter(fits) },
        { title: 'Other tools', tools: shown.filter((t) => !fits(t)), dim: true },
      ]
    : cat === 'all'
      ? (['pdf', 'image'] as const).map((c) => ({ title: titles[c], href: filterHref(c), tools: shown.filter((t) => t.category === c) }))
      : [{ tools: shown }]

  const open = (t: Tool) => {
    setHandoff(dropped)
    location.hash = `#/tool/${t.id}`
  }

  return (
    <div className="min-h-screen">
      <TopBar>
        <div className="relative min-w-0 max-sm:order-1 max-sm:w-full sm:w-80 lg:w-96">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 size-4.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tools, e.g. merge, resize"
            aria-label="Search tools"
            className={`h-11 w-full rounded-xl border border-field bg-canvas pl-11 pr-3 text-[15px] placeholder:text-muted ${focus}`}
          />
        </div>
      </TopBar>

      <main className="mx-auto max-w-[1600px] space-y-7 px-4 pb-14 pt-6 sm:px-8">
        <div>
          <Breadcrumb cat={cat} className="" />
          {/* the breadcrumb says where this is; the heading is kept for screen readers */}
          <h1 className="sr-only">{head}</h1>
        </div>

        <div className="max-w-200 space-y-3 text-muted mx-auto">
          <Dropzone
            accept={accepted}
            onFiles={setDropped}
            bar={{ title: 'Drop files to see which tools can open them', hint: "Tools that can't use them are dimmed. Nothing runs until you open a tool." }}
          />
          {dropped.length > 0 && (
            <p role="status" className="mt-3 flex items-center gap-3 text-sm">
              <span className="truncate">
                {dropped.length === 1 ? dropped[0].name : `${dropped.length} files ready`}.{' '}
                {tools.some(fits) ? 'Pick a tool below.' : 'No single tool takes all of these. Try one type of file at a time.'}
              </span>
              <button onClick={() => setDropped([])} className={`rounded-md font-semibold text-accent-ink underline ${focus}`}>Clear</button>
            </p>
          )}
        </div>

        {shown.length === 0 && <p className="rounded-2xl border border-line p-7 text-[15px] text-muted">No tool matches “{q.trim()}”. Try a shorter word, such as “pdf” or “image”.</p>}
        {sections.filter((s) => s.tools.length).map((s, i) => (
          <section key={s.title ?? i} aria-label={s.title ?? head} className="space-y-3">
            {s.title && (
              <h2 className="text-lg font-bold">
                {s.href ? <a href={s.href} className={`rounded-md hover:text-accent-ink hover:underline ${focus}`}>{s.title}</a> : s.title}
              </h2>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(250px,100%),1fr))] gap-3.5">
              {s.tools.map((t) => (
                <ToolCard key={t.id} tool={t} suggested={dropped.length > 0 && !s.dim} dim={s.dim} onOpen={dropped.length ? () => open(t) : undefined} />
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}

export function ToolCard({ tool: t, suggested, dim, onOpen }: { tool: Tool; suggested?: boolean; dim?: boolean; onOpen?: () => void }) {
  const body = (
    <>
      <span className="flex size-9.5 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent-ink">
        <Icon name={t.icon} className="size-4.75" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15.5px] font-bold">
          {t.title}
          {t.status === 'soon' && <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-normal text-muted">Soon</span>}
        </span>
        <span className="mt-0.5 block text-[13.5px] leading-snug text-muted">{t.description}</span>
      </span>
    </>
  )
  const edge = suggested ? 'border-accent ring-1 ring-accent' : dim ? 'border-line' : 'border-line hover:border-accent-2 hover:bg-surface-2'
  const box = `flex h-full w-full items-start gap-3.5 rounded-[14px] border bg-surface p-4.5 text-left transition-colors duration-150 ${edge}`
  if (dim) return <div aria-disabled="true" className={`${box} opacity-50`}>{body}</div>
  if (onOpen) return <button onClick={onOpen} className={`${box} ${focus}`}>{body}</button>
  return <a href={`#/tool/${t.id}`} className={`${box} ${focus}`}>{body}</a>
}
