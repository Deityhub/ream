import { Icon } from '@ream/ui'
import { findTool, tools } from '@ream/tools'
import type { Category, Tool } from '@ream/core'
import { Marketing, kicker, primary, secondary, wrap } from './Marketing'
import { install, installed, usePwa } from './pwa'
import { ToolCard } from './Home'
import { filterHref, focus } from './TopBar'

const ready = tools.filter((t) => t.status === 'ready')
const pick = (ids: string[]) => ids.map(findTool).filter((t): t is Tool => !!t)
const groups: { cat: Category; label: string; title: string; blurb: string; noun: string; tools: Tool[] }[] = [
  {
    cat: 'pdf',
    label: 'Documents',
    title: 'PDF tools',
    blurb: 'Merge, split, edit, sign, protect and convert PDFs.',
    noun: 'PDF',
    tools: pick(['merge-pdf', 'split-pdf', 'edit-pdf', 'compress-pdf', 'redact-pdf', 'pdf-to-word', 'sign-pdf', 'protect-pdf']),
  },
  {
    cat: 'image',
    label: 'Pictures',
    title: 'Image tools',
    blurb: 'Resize, compress, convert, crop and clean up images.',
    noun: 'image',
    tools: pick(['resize-image', 'compress-image', 'convert-image', 'crop-image', 'blur-image', 'image-metadata', 'filters-image', 'watermark-image']),
  },
]

const trust = [
  { icon: 'upload', title: 'No uploads', body: 'Files are read into memory on your computer and processed there. Ream has no server that receives files.' },
  { icon: 'wifi-off', title: 'Works offline', body: 'Visit once and every tool works with no connection. Install Ream to open it like any other app. Nothing about your files goes over the network.' },
  { icon: 'user-off', title: 'No account', body: 'No sign-up, no email, no profile. Open a tool and drop a file in.' },
]

const steps = [
  { title: 'Open a file', body: "Drop it in or pick it from a folder. Ream works on a copy in memory; the original isn't changed." },
  { title: 'Processed on your computer', body: 'The tool runs in a background worker on your own processor, with the options you set.' },
  { title: 'Save the result', body: 'Download it wherever you like. Close Ream and the copies in memory are gone.' },
]

const facts = [
  ['Files sent to a server', 'None'],
  ['Account', 'None'],
  ['Analytics or trackers', 'None'],
  ['Network requests', 'Font names, on your click'],
  ['Works offline', 'After one visit'],
]

const no = (i: number) => String(i + 1).padStart(2, '0')
const cell = 'blueprint flex flex-col gap-2 border border-line p-5'

/** the browser's own install offer, where it makes one (Chrome, Edge, Android) */
function InstallButton() {
  const { install: offer } = usePwa()
  if (!offer) return null
  return <button type="button" className={secondary} onClick={install}>Install Ream</button>
}

/** how to install where the browser has no offer to show: Safari has its own menu items, Firefox can't */
function InstallHint() {
  const { install: offer } = usePwa()
  if (offer || installed()) return null
  const ua = navigator.userAgent
  const apple = /iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox|FxiOS|CriOS/.test(ua)
  const hint = apple
    ? 'To install Ream, tap Share, then Add to Home Screen.'
    : safari
      ? 'To install Ream, choose File, then Add to Dock.'
      : /Firefox/.test(ua)
        ? "Firefox can't install sites as apps, but after one visit every tool here works offline."
        : null
  return hint && <p className="mt-4 text-[15px] text-muted">{hint}</p>
}

export function Landing() {
  return (
    <Marketing>
      <section className={`${wrap} pb-20 pt-16 sm:pt-24`}>
        <h1 className="text-[clamp(3rem,7vw,6rem)] leading-[1.04] tracking-normal uppercase">
          <span className="block">PDF and image tools</span>
          <span className="block">that run on</span>
          <span className="block text-accent-ink">your computer.</span>
        </h1>
        <p className="mt-8 max-w-[60ch] text-pretty text-lg leading-relaxed text-muted">
          Merge, split, sign and redact PDFs, turn them into Word, Excel or PowerPoint, and resize, compress or convert images. The work happens on your machine, so your files never reach a server.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a className={primary} href="#/tools">Open the tools</a>
          <InstallButton />
        </div>
        <InstallHint />
      </section>

      <section className={`${wrap} pt-8`}>
        <h2 className={kicker}>01 · Privacy</h2>
        <ul className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-6">
          {trust.map((t) => (
            <li key={t.title} className={cell}>
              <Icon name={t.icon} className="size-6 text-accent-ink" />
              <h3 className="mt-2 text-2xl uppercase">{t.title}</h3>
              <p className="text-[15px] leading-relaxed text-muted">{t.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${wrap} pt-24`}>
        <span className={kicker}>02 · How it works</span>
        <h2 className="mt-6 text-4xl uppercase">Your files stay where they already are.</h2>
        <ol className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))] gap-6">
          {steps.map((s, i) => (
            <li key={s.title} className={cell}>
              <span className="text-[13px] font-semibold tracking-widest text-accent-ink tabular-nums">{no(i)}</span>
              <h3 className="text-2xl uppercase">{s.title}</h3>
              <p className="text-[15px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${wrap} pt-24`}>
        {/* the spec sheet: a framed plate with a title block over the facts, tabulated */}
        <div className="blueprint border border-line">
          <div className="flex flex-wrap border-b border-line text-[13px] font-semibold tracking-widest uppercase">
            <h2 className="min-w-[16ch] flex-1 px-6 py-3 font-sans text-[13px] tracking-widest">Check it yourself</h2>
            <span className="border-l border-line px-6 py-3 text-muted">Sheet 03</span>
          </div>
          <p className="max-w-[70ch] px-6 pt-5 text-[15px] leading-relaxed text-muted">
            Open your browser's developer tools and watch the Network tab while a tool runs. Your file never appears there. The one request Ream can make is Download free fonts in the PDF tool (shown in Edit PDF, Excel to PDF and PowerPoint to PDF), which sends font names only, on your click.
          </p>
          <div className="overflow-x-auto px-6 pb-3 pt-4">
            <table className="w-full min-w-md text-left">
              <thead>
                <tr className="border-b border-line text-[13px] text-muted">
                  <th scope="col" className="w-16 py-3 font-semibold">№</th>
                  <th scope="col" className="py-3 font-semibold">Property</th>
                  <th scope="col" className="py-3 font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                {facts.map(([k, v], i) => (
                  <tr key={k} className="border-b border-line/50 last:border-0">
                    <td className="py-3 text-[13px] font-semibold tracking-widest text-accent-ink tabular-nums">{no(i)}</td>
                    <td className="py-3 text-[15px]">{k}</td>
                    <td className="py-3 font-heading text-lg font-semibold">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={`${wrap} flex flex-col items-start gap-6 pt-24`}>
        <h2 className="max-w-3xl text-[clamp(2.25rem,4.6vw,3.5rem)] leading-[1.04] uppercase">Pick a tool and start. Your files stay with you.</h2>
        <a className={primary} href="#/tools">Open the tools</a>
      </section>

      {groups.map((g, i) => (
        <section key={g.cat} className={`${wrap} pt-24`}>
          <span className={kicker}>{no(i + 3)} · {g.label}</span>
          <div className="mb-8 mt-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-4xl uppercase">{g.title}</h2>
              <p className="mt-1 text-[17px] text-muted">{g.blurb}</p>
            </div>
            <a href={filterHref(g.cat)} className={`font-heading text-lg font-semibold tracking-wide text-accent-ink uppercase hover:underline ${focus}`}>
              All {ready.filter((t) => t.category === g.cat).length} {g.noun} tools →
            </a>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-6">
            {g.tools.map((t) => <ToolCard key={t.id} tool={t} />)}
          </div>
        </section>
      ))}
    </Marketing>
  )
}
