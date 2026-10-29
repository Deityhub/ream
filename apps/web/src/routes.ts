// The app's pages and their URLs. Plain functions, no React or DOM: the router, the build (which writes a page for
// each route) and the tests all use them. Paths end in a slash, which is how Cloudflare Pages and NGINX serve
// `folder/index.html`, so a reload never goes through a redirect.
import type { Category, Tool } from '@ream/core'

export type Route =
  | { page: 'landing' }
  | { page: 'tools'; cat: 'all' | Category }
  | { page: 'tool'; id: string }
  | { page: 'licence' }
  | { page: 'notices' }
  | { page: 'notFound' }

// a Record, so adding a Category without its page stops compiling
const CATEGORY: Record<Category, true> = { pdf: true, image: true }
export const categories = Object.keys(CATEGORY) as Category[]

/** the page a URL path shows; anything unknown is `notFound` */
export function parseRoute(path: string): Route {
  const parts = path.split(/[?#]/)[0].split('/').filter(Boolean)
  const [a, b, ...more] = parts
  if (more.length) return { page: 'notFound' }
  if (!a) return { page: 'landing' }
  if (a === 'tools') {
    if (!b) return { page: 'tools', cat: 'all' }
    return b in CATEGORY ? { page: 'tools', cat: b as Category } : { page: 'notFound' }
  }
  if (a === 'tool') return b && /^[\w-]+$/.test(b) ? { page: 'tool', id: b } : { page: 'notFound' }
  if (!b && (a === 'licence' || a === 'notices')) return { page: a }
  return { page: 'notFound' }
}

/** the canonical path of a page, with its closing slash */
export function pathOf(route: Route): string {
  switch (route.page) {
    case 'landing':
      return '/'
    case 'tools':
      return route.cat === 'all' ? '/tools/' : `/tools/${route.cat}/`
    case 'tool':
      return `/tool/${route.id}/`
    case 'licence':
      return '/licence/'
    case 'notices':
      return '/notices/'
    case 'notFound':
      return '/404.html'
  }
}

export const toolPath = (id: string) => pathOf({ page: 'tool', id })
export const categoryPath = (cat: 'all' | Category) => pathOf({ page: 'tools', cat })

/** every page that has its own file in the build: the ones a visitor can reach, a tool still marked soon excepted */
export function allRoutes(tools: Tool[]): Route[] {
  return [
    { page: 'landing' },
    { page: 'tools', cat: 'all' },
    ...categories.map((cat): Route => ({ page: 'tools', cat })),
    ...tools.filter((t) => t.status === 'ready').map((t): Route => ({ page: 'tool', id: t.id })),
    { page: 'licence' },
    { page: 'notices' },
  ]
}

/** the path an old hash link (`#/tool/merge-pdf`, from before the app had real URLs) stands for, or null for any other hash */
export function legacyPath(hash: string): string | null {
  if (!hash.startsWith('#/')) return null
  const route = parseRoute(hash.slice(1))
  return route.page === 'notFound' ? null : pathOf(route)
}
