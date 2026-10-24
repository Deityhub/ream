import { Icon } from '@ream/ui'
import { findTool, tools } from '@ream/tools'
import type { Category, Tool } from '@ream/core'
import { Glow, Marketing, primary, secondary } from './Marketing'
import { ToolCard } from './Home'
import { filterHref, focus } from './TopBar'

const ready = tools.filter((t) => t.status === 'ready')
const pick = (ids: string[]) => ids.map(findTool).filter((t): t is Tool => !!t)
const groups: { cat: Category; title: string; blurb: string; noun: string; tools: Tool[] }[] = [
  {
    cat: 'pdf',
    title: 'PDF tools',
    blurb: 'Merge, split, edit, sign, protect and convert PDFs.',
    noun: 'PDF',
    tools: pick(['merge-pdf', 'split-pdf', 'edit-pdf', 'compress-pdf', 'redact-pdf', 'pdf-to-word', 'sign-pdf', 'protect-pdf']),
  },
  {
    cat: 'image',
    title: 'Image tools',
    blurb: 'Resize, compress, convert, crop and clean up images.',
    noun: 'image',
    tools: pick(['resize-image', 'compress-image', 'convert-image', 'crop-image', 'blur-image', 'image-metadata', 'filters-image', 'watermark-image']),
  },
]

const trust = [
  { icon: 'upload', title: 'No uploads', body: 'Files are read into memory on your computer and processed there. Ream has no server that receives files.' },
  { icon: 'wifi-off', title: 'Works offline', body: 'The desktop app needs no connection at all. In the browser, nothing about your files goes over the network.' },
  { icon: 'user-off', title: 'No account', body: 'No sign-up, no email, no profile. Open a tool and drop a file in.' },
]

const steps = [
  { title: 'Open a file', body: "Drop it in or pick it from a folder. Ream works on a copy in memory; the original isn't changed." },
  { title: 'Processed on your computer', body: 'The tool runs in a background worker on your own processor, with the options you set.' },
  { title: 'Save the result', body: 'Download it wherever you like. Close Ream and the copies in memory are gone.' },
]

const facts = [
  ['Files sent to a server', 'none'],
  ['Account', 'none'],
  ['Analytics or trackers', 'none'],
  ['Network requests', 'font names, on your click'],
]

export function Landing() {
  return (
    <Marketing>
      <section className="relative overflow-hidden">
        <Glow />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-7 px-4 pt-20 text-center sm:px-8 sm:pt-24">
          <h1 className="max-w-4xl text-balance text-[clamp(2.5rem,6.4vw,4.75rem)] font-bold leading-[1.04] tracking-tight">
            PDF and image tools that run <span className="text-accent-ink">on your computer.</span>
          </h1>
          <p className="max-w-2xl text-pretty text-lg leading-relaxed text-muted">
            Merge, split, sign and redact PDFs, turn them into Word, Excel or PowerPoint, and resize, compress or convert images. The work happens on your machine, so your files never reach a server.
          </p>
          <div className="flex flex-wrap justify-center gap-3.5">
            <a className={primary} href="#/tools">Open the tools</a>
            <a className={secondary} href="#/download">Get the desktop app</a>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-24 sm:px-8">
        <ol className="mt-9 grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-5">
          {trust.map((t, i) => (
            <li key={t.title} className="space-y-3 rounded-2xl border border-line bg-surface p-6">
              <Icon name={t.icon} className="size-6 text-accent-ink" />
              <h3 className="text-lg font-bold">{t.title}</h3>
              <p className="text-[15px] leading-relaxed text-muted">{t.body}</p>
            </li>
          ))}
        </ol>
      </section>


      <section className="mx-auto max-w-6xl px-4 pt-24 sm:px-8">
        <h2 className="text-center text-4xl font-bold tracking-tight">Your files stay where they already are.</h2>
        <ol className="mt-9 grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-5">
          {steps.map((s, i) => (
            <li key={s.title} className="space-y-3 rounded-2xl border border-line bg-surface p-6">
              <span className="block font-mono text-[13px] text-accent-ink">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="text-lg font-bold">{s.title}</h3>
              <p className="text-[15px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-24 sm:px-8">
        <div className="flex flex-wrap items-center gap-12 rounded-[22px] border border-line bg-surface p-6 sm:p-11">
          <div className="min-w-0 flex-[1_1_22rem] space-y-4">
            <h2 className="text-balance text-[34px] font-bold tracking-tight">Check it yourself.</h2>
            <p className="text-[16.5px] leading-relaxed text-muted">
              Open your browser's developer tools and watch the Network tab while a tool runs. Your file never appears there. The one request Ream can make is Download free fonts in the PDF tool (shown in Edit PDF, Excel to PDF and PowerPoint to PDF), which sends font names only, on your click.
            </p>
          </div>
          <dl className="min-w-0 flex-[1_1_22rem] space-y-3 rounded-[14px] border border-line bg-canvas p-5 font-mono text-[13px]">
            {facts.map(([k, v]) => (
              <div key={k} className="flex flex-wrap justify-between gap-x-4 border-line not-first:border-t not-first:pt-3">
                <dt className="text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 pt-24 text-center sm:px-8">
        <h2 className="max-w-2xl text-balance text-[clamp(2rem,4.6vw,3.25rem)] font-bold tracking-tight">Pick a tool and start. Your files stay with you.</h2>
        <a className={primary} href="#/tools">Open the tools</a>
      </section>

      {groups.map((g) => (
        <section key={g.cat} className="mx-auto max-w-6xl px-4 pt-16 sm:px-8">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[32px] font-bold tracking-tight">{g.title}</h2>
              <p className="mt-1.5 text-[17px] text-muted">{g.blurb}</p>
            </div>
            <a href={filterHref(g.cat)} className={`rounded-md text-[15px] font-semibold text-accent-ink hover:underline ${focus}`}>
              All {ready.filter((t) => t.category === g.cat).length} {g.noun} tools →
            </a>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-4">
            {g.tools.map((t) => <ToolCard key={t.id} tool={t} />)}
          </div>
        </section>
      ))}
    </Marketing>
  )
}
