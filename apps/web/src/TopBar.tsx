import type { ReactNode } from 'react'
import { Logo } from '@ream/ui'
import type { Category, Tool } from '@ream/core'
import { ThemeToggle } from './ThemeToggle'

export const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

// the landing and download pages sell the app; inside the desktop app they would only be in the way
export const desktop = navigator.userAgent.includes('Electron')
export const homeHref = desktop ? '#/tools' : '#/'

export type Filter = Category | 'all'
export const filterHref = (f: Filter) => (f === 'all' ? '#/tools' : `#/tools/${f}`)
const filterName: Record<Filter, string> = { all: 'All tools', pdf: 'PDF', image: 'Images' }

/** The app's bar: logo on the left; what the page adds (search) and the theme on the right. */
export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-4 sm:px-8">
        <a href={homeHref} className={`mr-auto flex items-center gap-2.5 rounded-md text-xl font-bold tracking-tight ${focus}`}>
          <Logo size={26} /> Ream
        </a>
        {children}
        <ThemeToggle />
      </div>
    </header>
  )
}

/** Where the page sits: All tools, then the category, then the tool. Every level is a link; the last one is the page itself. */
export function Breadcrumb({ cat, tool, className = 'mb-6' }: { cat: Filter; tool?: Tool; className?: string }) {
  const levels = [{ href: filterHref('all'), label: filterName.all }]
  if (cat !== 'all') levels.push({ href: filterHref(cat), label: filterName[cat] })
  if (tool) levels.push({ href: `#/tool/${tool.id}`, label: tool.title })
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex min-w-0 flex-wrap items-center gap-2.5 text-sm text-muted">
        {levels.map((l, i) => {
          const last = i === levels.length - 1
          return (
            <li key={l.href} className="flex min-w-0 items-center gap-2.5">
              {i > 0 && <span aria-hidden="true">/</span>}
              <a
                href={l.href}
                aria-current={last ? 'page' : undefined}
                className={`truncate rounded-md hover:text-ink hover:underline ${focus} ${last ? 'font-semibold text-ink' : ''}`}
              >
                {l.label}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
