import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import { legacyPath } from './routes'

// path routing with the History API: no router dependency, and a real URL for every page (see routes.ts)
const CHANGED = 'ream:navigate'

const subscribe = (on: () => void) => {
  addEventListener('popstate', on)
  addEventListener(CHANGED, on)
  return () => {
    removeEventListener('popstate', on)
    removeEventListener(CHANGED, on)
  }
}

/** the current URL path; the page re-renders when it changes */
export const usePath = () => useSyncExternalStore(subscribe, () => location.pathname, () => '/')

export function navigate(to: string, { replace = false } = {}) {
  if (to === location.pathname) return scrollTo(0, 0)
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  dispatchEvent(new Event(CHANGED))
}

/** a real link (crawlers, new tabs and copying the address all work); a plain click moves inside the app instead of loading the page again */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (rest.target && rest.target !== '_self')) return
    e.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={go} {...rest} />
}

/** old links (`/#/tool/merge-pdf`, and installed apps that open `#/tools`) become real URLs before the first render */
export function upgradeLegacyUrl() {
  const path = legacyPath(location.hash)
  if (path) history.replaceState(null, '', path)
}
