import { useEffect, useState, type ReactNode } from 'react'
import { Marketing, kicker, wrap } from './Marketing'

// the texts are the repo's own files, loaded only when one of these pages opens
const sources = {
  licence: { title: 'Licence', load: () => import('../../../LICENSE?raw') },
  notices: { title: 'Third-party notices', load: () => import('../../../THIRD-PARTY-NOTICES.md?raw') },
}
export type LegalPage = keyof typeof sources

/** a licence text wrapped at 80 columns, as paragraphs that wrap to the page (rules of dashes dropped) */
function prose(text: string, key: number | string) {
  const paras = text.split(/\n\s*\n/).map((p) => p.split('\n').filter((l) => !/^-{5,}$/.test(l.trim())).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
  return (
    <div key={key} className="max-w-[75ch] space-y-3 text-[15px] leading-relaxed">
      {paras.map((p, i) => <p key={i}>{p}</p>)}
    </div>
  )
}

/** The few kinds of line the two files have: headings, list items, fenced licence texts, paragraphs. */
function blocks(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const lines = text.split('\n')
  const inline = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const body: string[] = []
      while (++i < lines.length && !lines[i].startsWith('```')) body.push(lines[i])
      out.push(<div key={i} className="max-w-[75ch] border border-line p-5 text-muted">{prose(body.join('\n'), 0)}</div>)
    } else if (line.startsWith('# ') || line.startsWith('<!--')) continue // the page title says it; comments are for the repo
    else if (line.startsWith('## ')) out.push(<h2 key={i} className={`${kicker} pt-6`}>{line.slice(3)}</h2>)
    else if (line.startsWith('### ')) out.push(<h3 key={i} className="pt-2 text-xl">{line.slice(4)}</h3>)
    else if (line.startsWith('- ')) out.push(<p key={i} className="border-l border-line pl-3 text-[15px] leading-relaxed">{inline(line.slice(2))}</p>)
    else if (line.trim()) out.push(<p key={i} className="max-w-[75ch] text-[15px] leading-relaxed">{inline(line)}</p>)
  }
  return out
}

/** Ream's licence, or the licences of what it ships from others, as pages of the site. */
export function Legal({ page }: { page: LegalPage }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setText(null)
    sources[page].load().then((m) => live && setText(m.default))
    return () => {
      live = false
    }
  }, [page])
  const source = sources[page]
  return (
    <Marketing>
      <article className={`${wrap} space-y-4 pt-16`}>
        <h1 className="pb-4 text-[clamp(2.5rem,5vw,4rem)] leading-[1.04] uppercase">{source.title}</h1>
        {text === null ? <p role="status" className="text-muted">Loading…</p> : page === 'licence' ? prose(text, 'licence') : blocks(text)}
      </article>
    </Marketing>
  )
}
