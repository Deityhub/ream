import { Link } from './router'
import { Marketing, primary, secondary, wrap } from './Marketing'

export function NotFound() {
  return (
    <Marketing>
      <section className={`${wrap} pb-20 pt-16 sm:pt-24`}>
        <h1 className="text-[clamp(3rem,7vw,6rem)] leading-[1.04] uppercase">Page not found</h1>
        <p className="mt-8 max-w-[60ch] text-lg leading-relaxed text-muted">There is nothing at this address. Check it for typing mistakes, or pick a tool from the list.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link className={primary} to="/tools/">Open the tools</Link>
          <Link className={secondary} to="/">Home</Link>
        </div>
      </section>
    </Marketing>
  )
}
