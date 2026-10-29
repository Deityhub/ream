import type { Tool } from '@ream/core'
import { seoOf } from '@ream/tools/seo'
import { Link } from './router'
import { focus } from './TopBar'
import { toolPath } from './routes'
import { relatedTools } from './seo'

/** the words of a tool's page, under the tool: what it does, what to know, and where to go next (the same text the page's file holds for crawlers) */
export function ToolAbout({ tool }: { tool: Tool }) {
  const s = seoOf(tool)
  if (!s.points.length && !s.faq.length) return null
  const more = relatedTools(tool)
  return (
    <section aria-labelledby="about-tool" className="mt-16 max-w-[70ch] border-t border-line pt-8">
      <h2 id="about-tool" className="text-3xl uppercase">About {tool.title}</h2>
      <p className="mt-4 text-[15px] leading-relaxed text-muted">{s.intro}</p>
      {s.points.length > 0 && (
        <>
          <h3 className="mt-8 text-xl uppercase">What you can do</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-muted">
            {s.points.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </>
      )}
      {s.faq.length > 0 && (
        <>
          <h3 className="mt-8 text-xl uppercase">Questions</h3>
          <dl className="mt-2 space-y-4 text-[15px] leading-relaxed">
            {s.faq.map(([q, a]) => (
              <div key={q}>
                <dt className="font-semibold">{q}</dt>
                <dd className="text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {more.length > 0 && (
        <>
          <h3 className="mt-8 text-xl uppercase">More {tool.category === 'pdf' ? 'PDF' : 'image'} tools</h3>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
            {more.map((t) => (
              <li key={t.id}><Link to={toolPath(t.id)} className={`text-accent-ink underline ${focus}`}>{t.title}</Link></li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
