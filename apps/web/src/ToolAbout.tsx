import type { Tool } from '@ream/core'
import { seoOf } from '@ream/tools/seo'
import { Link } from './router'
import { focus } from './TopBar'
import { toolPath } from './routes'
import { relatedTools } from './seo'

const cell = 'blueprint flex flex-col gap-3 border border-line p-6'

/**
 * The words of a tool's page, under the empty tool: four framed cells (what it does, what you can do, questions, more
 * tools). The same text the page's file holds for crawlers. Shown only until a file is added: it is no help while editing.
 */
export function ToolAbout({ tool }: { tool: Tool }) {
  const s = seoOf(tool)
  if (!s.points.length && !s.faq.length) return null
  const more = relatedTools(tool)
  return (
    <div className="mt-20 grid gap-6 md:grid-cols-2">
      <section aria-labelledby="about-tool" className={cell}>
        <h2 id="about-tool" className="text-2xl uppercase">About {tool.title}</h2>
        <p className="text-[15px] leading-relaxed text-muted">{s.intro}</p>
      </section>
      <section aria-labelledby="about-points" className={cell}>
        <h2 id="about-points" className="text-2xl uppercase">What you can do</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-muted">
          {s.points.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </section>
      <section aria-labelledby="about-faq" className={cell}>
        <h2 id="about-faq" className="text-2xl uppercase">Questions</h2>
        <dl className="space-y-4 text-[15px] leading-relaxed">
          {s.faq.map(([q, a]) => (
            <div key={q}>
              <dt className="font-semibold">{q}</dt>
              <dd className="text-muted">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="about-more" className={cell}>
        <h2 id="about-more" className="text-2xl uppercase">More {tool.category === 'pdf' ? 'PDF' : 'image'} tools</h2>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[15px]">
          {more.map((t) => (
            <li key={t.id}><Link to={toolPath(t)} className={`text-accent-ink underline ${focus}`}>{t.title}</Link></li>
          ))}
        </ul>
      </section>
    </div>
  )
}
