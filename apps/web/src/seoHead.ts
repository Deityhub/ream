// Keeps the document's head in step with the page while moving around inside the app (a file opened at an address
// already has the right head from the build). Loaded on demand: it carries every tool's text.
import { headTags, pageSeo } from './seo'
import type { Route } from './routes'

export function applyHead(route: Route) {
  const s = pageSeo(route, __APP_VERSION__)
  document.title = s.title
  document.querySelector('meta[name="description"]')?.setAttribute('content', s.description)
  document.head.querySelectorAll('[data-seo]').forEach((e) => e.remove())
  document.head.insertAdjacentHTML('beforeend', headTags(s))
}
