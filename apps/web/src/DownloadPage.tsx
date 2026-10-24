import { Icon } from '@ream/ui'
import { Glow, Marketing, primary } from './Marketing'

// the supported systems are Electron 38's
const platforms = [
  { id: 'mac', name: 'macOS', req: 'macOS 12 Monterey or later, Apple silicon or Intel.' },
  { id: 'win', name: 'Windows', req: 'Windows 10 or later, 64-bit.' },
  { id: 'linux', name: 'Linux', req: '64-bit Linux with a desktop, such as Ubuntu, Debian or Fedora.' },
]
const ua = navigator.userAgent
const detected = /Mac/.test(ua) ? 'mac' : /Win/.test(ua) ? 'win' : /Linux/.test(ua) && !/Android/.test(ua) ? 'linux' : null

const differences = [
  'Works with no internet connection at all, from the first start.',
  'Fonts installed on your computer are offered in Edit PDF, Excel to PDF and PowerPoint to PDF without a permission prompt.',
  'The same tools as the browser version.',
]

export function DownloadPage() {
  return (
    <Marketing>
      <section className="relative overflow-hidden">
        <Glow />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-5 px-4 pb-10 pt-20 text-center sm:px-8">
          <h1 className="text-balance text-[clamp(2.25rem,5.2vw,3.75rem)] font-bold leading-[1.06] tracking-tight">
            Ream for your desktop. <span className="text-accent-ink">No connection needed.</span>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted">The same tools as the web version, in an app for macOS, Windows and Linux. No account, no sign-in.</p>
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-5 px-4 sm:px-8">
        <p role="note" className="flex items-start gap-3 rounded-[14px] border border-line bg-surface px-5 py-4 text-[15px] leading-relaxed">
          <Icon name="info" className="mt-0.5 size-5 shrink-0 text-accent-ink" />
          <span>
            Installers aren't published yet. Until they are, use Ream in your browser: <a className="font-semibold text-accent-ink underline" href="#/tools">open the tools</a>. Developers can run the app from the source code with <code className="font-mono text-sm">yarn desktop</code>.
          </span>
        </p>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))] gap-5">
          {platforms.map((p) => (
            <div key={p.id} className={`flex flex-col gap-4 rounded-[18px] border bg-surface p-6 ${p.id === detected ? 'border-accent-2' : 'border-line'}`}>
              <span className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-extrabold">{p.name}</h2>
                {p.id === detected && <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-on-accent">Your system</span>}
              </span>
              <p className="flex-1 text-[14.5px] leading-relaxed text-muted">{p.req}</p>
              <button disabled className="min-h-12 rounded-xl border border-line bg-surface-2 px-4 text-[15px] font-bold disabled:cursor-not-allowed disabled:opacity-60">
                Not released yet
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-4 rounded-[18px] border border-line bg-surface p-7">
          <h2 className="text-lg font-extrabold">How the desktop app differs</h2>
          <ul className="space-y-3">
            {differences.map((d) => (
              <li key={d} className="flex items-start gap-3 text-[15px] leading-relaxed">
                <Icon name="check" className="mt-1 size-4 shrink-0 text-success" />
                {d}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-center pt-8">
          <a className={primary} href="#/tools">Use Ream in your browser</a>
        </div>
      </div>
    </Marketing>
  )
}
