import type { ReactNode } from 'react'
import { Logo } from '@ream/ui'
import { ThemeToggle } from './ThemeToggle'
import { focus } from './TopBar'

export const primary = `inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-6 text-base font-bold text-on-accent transition-colors duration-150 hover:bg-accent-hover ${focus}`
export const secondary = `inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-surface px-6 text-base font-semibold transition-colors duration-150 hover:border-accent-2 ${focus}`

/** Frame of the web-only pages (landing, download): their own nav and footer, not the app's bar. */
export function Marketing({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <a href="#/" className={`flex items-center gap-2.5 rounded-md text-xl font-bold tracking-tight ${focus}`}>
            <Logo size={26} /> Ream
          </a>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px] font-medium">
            <ThemeToggle />
          </nav>
        </div>
      </header>
      {children}
      <footer className="mt-24 border-t border-line">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-7 text-sm text-muted sm:px-8">
          <span className="flex items-center gap-2.5 font-bold text-ink">
            <Logo size={22} /> Ream
          </span>
          <span className="text-[13px] text-muted">© {new Date().getFullYear()} Ream, Inc. All rights reserved.</span>
          
        </div>
      </footer>
    </div>
  )
}

/** the soft accent glow behind a hero; decoration only */
export function Glow() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -top-32 left-1/2 h-[30rem] w-[min(56rem,100%)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,color-mix(in_srgb,var(--accent-2)_32%,transparent),transparent_70%)]"
    />
  )
}
