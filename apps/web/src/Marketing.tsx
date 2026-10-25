import type { ReactNode } from 'react'
import { Logo } from '@ream/ui'
import { ThemeToggle } from './ThemeToggle'
import { focus } from './TopBar'

const action = `inline-flex min-h-11 items-center justify-center px-5 font-heading text-[17px] font-semibold tracking-wide transition-colors duration-150 ${focus}`
/** the one solid object on a page: an accent fill wearing the corner marks */
export const primary = `${action} blueprint border border-accent bg-accent text-on-accent hover:border-accent-hover hover:bg-accent-hover`
export const secondary = `${action} border border-line hover:bg-ink/7`
/** a section's label: small caps in the deep steel, sitting over a hairline */
export const kicker = 'block border-b border-line pb-2 font-sans text-[13px] font-semibold tracking-widest text-accent-ink uppercase tabular-nums'
export const wrap = 'mx-auto max-w-[1600px] px-4 sm:px-8'

/** Frame of the web-only pages (landing, download): their own nav and footer, not the app's bar. */
export function Marketing({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header>
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-4 py-4`}>
          <a href="#/" className={`flex items-center gap-2 font-heading text-[22px] font-semibold tracking-wide uppercase ${focus}`}>
            <Logo size={24} /> Ream
          </a>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px] font-medium">
            <ThemeToggle />
          </nav>
        </div>
      </header>
      {children}
      <footer className="mt-24">
        <div className={`${wrap} flex flex-wrap items-center justify-between gap-4 border-t border-line py-7 text-sm text-muted`}>
          <span className="flex items-center gap-2 font-heading text-lg font-semibold tracking-wide text-ink uppercase">
            <Logo size={20} /> Ream
          </span>
          <span className="text-[13px] text-muted">© {new Date().getFullYear()} Ream, Inc. All rights reserved.</span>
        </div>
      </footer>
    </div>
  )
}
