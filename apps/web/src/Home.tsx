import { useState } from 'react'
import { Dropzone, Icon } from '@ream/ui'
import { tools } from '@ream/tools'
import { acceptsFile, type Category, type Tool } from '@ream/core'
import { setHandoff } from './handoff'
import { Breadcrumb, TopBar, filterHref, focus, type Filter } from './TopBar'
import { Link, navigate } from './router'
import { toolPath } from './routes'

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
    navigate(toolPath(t))
  }

  return (
    <div className="min-h-screen">
      <TopBar>
        <div className="relative min-w-0 max-sm:order-1 max-sm:w-full sm:w-80 lg:w-96">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4.5 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tools, e.g. merge, resize"
            aria-label="Search tools"
            className={`h-9 w-full border border-field bg-surface-2 pl-10 pr-3 text-sm placeholder:text-muted pointer-coarse:h-11 ${focus}`}
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
              <button onClick={() => setDropped([])} className={`font-semibold text-accent-ink underline ${focus}`}>Clear</button>
            </p>
          )}
        </div>

        {shown.length === 0 && <p className="border border-line p-7 text-[15px] text-muted">No tool matches “{q.trim()}”. Try a shorter word, such as “pdf” or “image”.</p>}
        {sections.filter((s) => s.tools.length).map((s, i) => (
          <section key={s.title ?? i} aria-label={s.title ?? head} className="space-y-5">
            {s.title && (
              <h2 className="border-b border-line pb-2 text-2xl uppercase">
                {s.href ? <Link to={s.href} className={`hover:text-accent-ink hover:underline ${focus}`}>{s.title}</Link> : s.title}
              </h2>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(250px,100%),1fr))] gap-5">
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
  // Industry's card: kicker, condensed title, body; the icon sits opposite the kicker
  const body = (
    <>
      <span className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold tracking-widest text-accent-ink uppercase">
          {t.category === 'pdf' ? 'PDF' : 'Image'}
          {t.status === 'soon' && ' · Soon'}
        </span>
        <Icon name={t.icon} className="size-5 text-accent-ink" />
      </span>
      <span className="font-heading text-xl leading-tight font-semibold">{t.title}</span>
      <span className="text-sm leading-snug text-muted">{t.description}</span>
    </>
  )
  const edge = suggested ? 'border-accent ring-1 ring-accent' : dim ? 'border-line' : 'border-line hover:border-accent-2 hover:bg-ink/4'
  const box = `blueprint flex h-full w-full flex-col gap-1.5 border p-4 text-left transition-colors duration-150 ${edge}`
  if (dim) return <div aria-disabled="true" className={`${box} opacity-50`}>{body}</div>
  if (onOpen) return <button onClick={onOpen} className={`${box} ${focus}`}>{body}</button>
  return <Link to={toolPath(t)} className={`${box} ${focus}`}>{body}</Link>
}
