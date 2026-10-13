import { useState } from 'react'
import { Card, Icon } from '@ream/ui'
import { tools } from '@ream/tools'
import type { Category } from '@ream/core'

const chips: { label: string; value: Category | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'PDF', value: 'pdf' },
  { label: 'Image', value: 'image' },
]

export function Home() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<Category | 'all'>('all')
  const needle = q.trim().toLowerCase()
  const shown = tools.filter(
    (t) => (cat === 'all' || t.category === cat) && (t.title + ' ' + t.description).toLowerCase().includes(needle),
  )

  return (
    <>
      <div className="relative mb-4">
        <Icon name="search" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tools, e.g. merge, resize"
          aria-label="Search tools"
          className="w-full rounded-lg border border-field bg-surface py-2 pl-9 pr-3 text-sm placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>
      <div className="mb-4 flex gap-2" role="group" aria-label="Filter by category">
        {chips.map((c) => (
          <button
            key={c.value}
            onClick={() => setCat(c.value)}
            aria-pressed={cat === c.value}
            className={`rounded-full px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-accent ${cat === c.value ? 'bg-accent text-on-accent' : 'border border-line bg-surface hover:bg-surface-2'}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No tools match that search.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {shown.map((t) => (
            <a key={t.id} href={`#/tool/${t.id}`} className="rounded-xl focus-visible:outline-2 focus-visible:outline-accent">
              <Card className="h-full hover:bg-surface-2">
                <Icon name={t.icon} className="mb-2 size-5 text-accent" />
                <p className="text-sm font-medium">
                  {t.title}
                  {t.status === 'soon' && <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-normal text-muted">Soon</span>}
                </p>
                <p className="text-xs text-muted">{t.description}</p>
              </Card>
            </a>
          ))}
        </div>
      )}
    </>
  )
}
