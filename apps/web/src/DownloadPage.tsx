import { Icon } from '@ream/ui'
import { Marketing, kicker, primary, wrap } from './Marketing'

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
      <section className={`${wrap} pb-14 pt-16 sm:pt-24`}>
        <h1 className="text-[clamp(2.75rem,6vw,5rem)] leading-[1.04] tracking-normal uppercase">
          <span className="block">Ream for your desktop.</span>
          <span className="block text-accent-ink">No connection needed.</span>
        </h1>
        <p className="mt-8 max-w-[60ch] text-lg leading-relaxed text-muted">The same tools as the web version, in an app for macOS, Windows and Linux. No account, no sign-in.</p>
      </section>

      <div className={`${wrap} space-y-8`}>
        <p role="note" className="flex items-start gap-3 border border-line px-5 py-4 text-[15px] leading-relaxed">
          <Icon name="info" className="mt-0.5 size-5 shrink-0 text-accent-ink" />
          <span>
            Installers aren't published yet. Until they are, use Ream in your browser: <a className="font-semibold text-accent-ink underline" href="#/tools">open the tools</a>. Developers can run the app from the source code with <code className="font-mono text-sm">yarn desktop</code>.
          </span>
        </p>

        <section>
          <h2 className={kicker}>01 · Platforms</h2>
          <div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))] gap-6">
            {platforms.map((p) => (
              <div key={p.id} className={`blueprint flex flex-col gap-3 border p-5 ${p.id === detected ? 'border-accent-2' : 'border-line'}`}>
                <span className="flex items-center justify-between gap-3">
                  <h3 className="text-2xl uppercase">{p.name}</h3>
                  {p.id === detected && <span className="bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold tracking-widest text-accent-ink uppercase">Your system</span>}
                </span>
                <p className="flex-1 text-[15px] leading-relaxed text-muted">{p.req}</p>
                <button disabled className="mt-2 min-h-11 border border-line px-4 font-heading text-[17px] font-semibold tracking-wide disabled:opacity-60">
                  Not released yet
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-6 pt-8">
          <h2 className={kicker}>02 · How the desktop app differs</h2>
          <ul className="space-y-3">
            {differences.map((d) => (
              <li key={d} className="flex items-start gap-3 text-[15px] leading-relaxed">
                <Icon name="check" className="mt-1 size-4 shrink-0 text-success" />
                {d}
              </li>
            ))}
          </ul>
        </section>

        <div className="pt-8">
          <a className={primary} href="#/tools">Use Ream in your browser</a>
        </div>
      </div>
    </Marketing>
  )
}
