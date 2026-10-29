// The app's pages and their URLs. Plain functions, no React or DOM: the router, the build (which writes a page for
// each route) and the tests all use them. Paths end in a slash, which is how Cloudflare Pages and NGINX serve
// `folder/index.html`, so a reload never goes through a redirect.
//
//   /                          the landing page
//   /tools/                    all tools            /tools/pdf/  /tools/image/    one kind of tool
//   /tools/pdf/sign-pdf/       a tool, always under its own kind
//   /licence/  /notices/       the legal texts
//
// An address that is none of these is `notFound`, and so is a tool that doesn't exist or is under the wrong kind.
import type { Category, Tool } from '@ream/core'
import { findTool } from '@ream/tools'

export type Route =
  | { page: 'landing' }
  | { page: 'tools'; cat: 'all' | Category }
  | { page: 'tool'; tool: Tool }
  | { page: 'licence' }
  | { page: 'notices' }
  | { page: 'notFound' }

// a Record, so adding a Category without its page stops compiling
const CATEGORY: Record<Category, true> = { pdf: true, image: true }
export const categories = Object.keys(CATEGORY) as Category[]
const isCategory = (s: string): s is Category => Object.hasOwn(CATEGORY, s)

/** the page a URL path shows; anything unknown is `notFound` */
export function parseRoute(path: string): Route {
  const [a, b, c, ...more] = path.split(/[?#]/)[0].split('/').filter(Boolean)
  if (more.length) return { page: 'notFound' }
  if (!a) return { page: 'landing' }
  if (a === 'tools') {
    if (!b) return { page: 'tools', cat: 'all' }
    if (!isCategory(b)) return { page: 'notFound' }
    if (!c) return { page: 'tools', cat: b }
    const tool = findTool(c)
    return tool && tool.category === b ? { page: 'tool', tool } : { page: 'notFound' }
  }
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
      return toolPath(route.tool)
    case 'licence':
      return '/licence/'
    case 'notices':
      return '/notices/'
    case 'notFound':
      return '/404.html'
  }
}

export const toolPath = (tool: Pick<Tool, 'id' | 'category'>) => `/tools/${tool.category}/${tool.id}/`
export const categoryPath = (cat: 'all' | Category) => pathOf({ page: 'tools', cat })

/** every page that has its own file in the build: the ones a visitor can reach, a tool still marked soon excepted */
export function allRoutes(tools: Tool[]): Route[] {
  return [
    { page: 'landing' },
    { page: 'tools', cat: 'all' },
    ...categories.map((cat): Route => ({ page: 'tools', cat })),
    ...tools.filter((t) => t.status === 'ready').map((tool): Route => ({ page: 'tool', tool })),
    { page: 'licence' },
    { page: 'notices' },
  ]
}

/** the path an old hash link (`#/tool/merge-pdf`, from before the app had real URLs) stands for, or null for any other hash */
export function legacyPath(hash: string): string | null {
  if (!hash.startsWith('#/')) return null
  const old = /^#\/tool\/([\w-]+)\/?$/.exec(hash)
  if (old) {
    const tool = findTool(old[1])
    return tool ? toolPath(tool) : `/tool/${old[1]}/` // a tool that doesn't exist: an address that isn't a page, so the not-found page shows
  }
  const route = parseRoute(hash.slice(1))
  return route.page === 'notFound' ? null : pathOf(route)
}
