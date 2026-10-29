// What search engines and social cards read for each page: title, description, canonical address, structured data and the
// text inside #root. One source for the build (which writes a file per route, see ../seoPlugin.ts) and for the app (which
// keeps the head in step when you move between pages). Plain functions, no React or DOM.
import type { Category, Tool } from '@ream/core'
import { tools } from '@ream/tools'
import { seoOf } from '@ream/tools/seo'
import { categoryPath, toolPath, type Route, pathOf } from './routes'

/** where the site lives: canonical addresses, the sitemap and the social card point here, also from a self-hosted copy */
export const SITE = 'https://ream.deityhub.com'
export const OG_IMAGE = `${SITE}/og.png`

const CATEGORY_NAME: Record<Category, { title: string; noun: string }> = {
  pdf: { title: 'PDF tools', noun: 'PDF' },
  image: { title: 'Image tools', noun: 'image' },
}

export type PageSeo = {
  title: string
  description: string
  /** the page's own path, which is also its canonical address */
  path: string
  /** pages that should not be listed: the 404 page, the licence texts, a tool that doesn't exist */
  index: boolean
  jsonLd: object[]
  /** plain HTML for inside #root: what a crawler that doesn't run scripts, and the first moment of a load, show */
  html: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const PRIVACY =
  'Ream runs entirely on your device. Your files are opened and changed by code in your own browser and are never uploaded, there is no account to make, and once you have visited, it works offline. Up to 50 files at a time, 200 MB each and 500 MB in all.'

const ready = tools.filter((t) => t.status === 'ready')
const inCategory = (cat: Category) => ready.filter((t) => t.category === cat)

/** the tools a visitor may want next: others of the same kind, up to six */
export const relatedTools = (tool: Tool) => ready.filter((t) => t.category === tool.category && t.id !== tool.id).slice(0, 6)

const link = (path: string, text: string) => `<a href="${path}">${esc(text)}</a>`
const list = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
const toolLinks = (ts: Tool[]) => list(ts.map((t) => `${link(toolPath(t), t.title)}: ${esc(t.description)}`))

const breadcrumb = (items: [name: string, path: string][]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + path })),
})

const author = { '@type': 'Person', name: 'Chizoba Jude Ojini' }
const free = { '@type': 'Offer', price: '0', priceCurrency: 'USD' }

export function pageSeo(route: Route, version: string): PageSeo {
  const path = pathOf(route)
  switch (route.page) {
    case 'landing': {
      const description = 'The file toolkit that runs on your computer. Convert, edit, compress and secure PDFs, images and Office files. Nothing is uploaded.'
      return {
        title: 'Ream: private file tools for PDFs, images and Office files',
        description,
        path,
        index: true,
        jsonLd: [
          { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Ream', url: SITE + '/', description, inLanguage: 'en' },
          {
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: 'Ream',
            url: SITE + '/',
            description,
            applicationCategory: 'UtilitiesApplication',
            operatingSystem: 'Any',
            browserRequirements: 'Requires a current web browser',
            softwareVersion: version,
            isAccessibleForFree: true,
            offers: free,
            license: 'https://opensource.org/licenses/MIT',
            author,
            featureList: ready.map((t) => t.title),
          },
        ],
        html: `<main class="seo"><h1>The file toolkit that runs on your computer</h1><p>${esc(description)}</p><p>${esc(PRIVACY)}</p><h2>PDF tools</h2>${toolLinks(inCategory('pdf'))}<h2>Image tools</h2>${toolLinks(inCategory('image'))}<p>${link('/tools/', 'See all tools')}</p></main>`,
      }
    }
    case 'tools': {
      const cat = route.cat
      const group = cat === 'all' ? ready : inCategory(cat)
      const name = cat === 'all' ? 'All tools' : CATEGORY_NAME[cat].title
      const title = cat === 'all' ? 'All file tools: PDF, image and Office | Ream' : cat === 'pdf' ? 'PDF tools: merge, split, compress, edit, convert | Ream' : 'Image tools: resize, convert, compress, crop | Ream'
      const description =
        cat === 'all'
          ? `${group.length} tools to convert, edit, compress and secure PDFs, images and Office files, all running on your device. Nothing is uploaded.`
          : `${group.length} ${CATEGORY_NAME[cat].noun} tools that run in your browser: ${group.slice(0, 5).map((t) => t.title.toLowerCase()).join(', ')} and more. Nothing is uploaded.`
      const crumbs: [string, string][] = [['Ream', '/'], ['All tools', '/tools/']]
      if (cat !== 'all') crumbs.push([name, categoryPath(cat)])
      return {
        title,
        description,
        path,
        index: true,
        jsonLd: [breadcrumb(crumbs), { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: group.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + toolPath(t), name: t.title })) }],
        html: `<main class="seo"><h1>${esc(name)}</h1><p>${esc(description)}</p>${toolLinks(group)}<p>${link('/', 'Back to Ream')}</p></main>`,
      }
    }
    case 'tool': {
      const tool = route.tool
      if (tool.status !== 'ready') return notFound('This tool is not ready')
      const s = seoOf(tool)
      const cat = CATEGORY_NAME[tool.category]
      return {
        title: s.title,
        description: s.description,
        path,
        index: true,
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: tool.title,
            url: SITE + path,
            description: s.description,
            applicationCategory: 'UtilitiesApplication',
            operatingSystem: 'Any',
            browserRequirements: 'Requires a current web browser',
            isAccessibleForFree: true,
            offers: free,
            author,
            isPartOf: { '@type': 'WebSite', name: 'Ream', url: SITE + '/' },
            ...(s.points.length ? { featureList: s.points } : {}),
          },
          breadcrumb([['Ream', '/'], ['All tools', '/tools/'], [cat.title, categoryPath(tool.category)], [tool.title, path]]),
        ],
        html: `<main class="seo"><p>${link('/tools/', 'All tools')} / ${link(categoryPath(tool.category), cat.title)}</p><h1>${esc(tool.title)}</h1><p>${esc(s.intro)}</p>${s.points.length ? `<h2>What you can do</h2>${list(s.points.map(esc))}` : ''}<h2>Private by design</h2><p>${esc(PRIVACY)}</p>${s.faq.length ? `<h2>Questions</h2><dl>${s.faq.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl>` : ''}<h2>More ${cat.noun} tools</h2>${toolLinks(relatedTools(tool))}</main>`,
      }
    }
    case 'licence':
      return { title: 'MIT licence | Ream', description: 'Ream is free software under the MIT licence.', path, index: false, jsonLd: [], html: '<main class="seo"><h1>Licence</h1><p>Ream is released under the MIT licence.</p></main>' }
    case 'notices':
      return { title: 'Third-party notices | Ream', description: 'The licences of the software and fonts Ream ships from others.', path, index: false, jsonLd: [], html: '<main class="seo"><h1>Third-party notices</h1><p>The licences of the software and fonts Ream ships from others.</p></main>' }
    case 'notFound':
      return notFound('Page not found')
  }
}

function notFound(title: string): PageSeo {
  return { title: `${title} | Ream`, description: 'There is nothing at this address.', path: '/404.html', index: false, jsonLd: [], html: `<main class="seo"><h1>${esc(title)}</h1><p>There is nothing at this address. ${link('/tools/', 'Open the tools')}</p></main>` }
}

const absolute = (s: PageSeo) => SITE + s.path

/** the tags a page's head needs, as HTML (marked `data-seo` so the app can swap them): the build puts them in the file, the app sets the same values when you move between pages */
export function headTags(s: PageSeo): string {
  const url = absolute(s)
  // a page that doesn't exist has no address of its own to declare
  const own = s.path !== '/404.html'
  const meta = (attr: 'name' | 'property', key: string, value: string) => `<meta data-seo ${attr}="${key}" content="${esc(value)}" />`
  return [
    ...(own ? [`<link data-seo rel="canonical" href="${esc(url)}" />`] : []),
    meta('name', 'robots', s.index ? 'index, follow, max-image-preview:large' : 'noindex, follow'),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', 'Ream'),
    meta('property', 'og:title', s.title),
    meta('property', 'og:description', s.description),
    ...(own ? [meta('property', 'og:url', url)] : []),
    meta('property', 'og:image', OG_IMAGE),
    meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '630'),
    meta('property', 'og:image:alt', 'Ream: the file toolkit that runs on your computer'),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', s.title),
    meta('name', 'twitter:description', s.description),
    meta('name', 'twitter:image', OG_IMAGE),
    ...s.jsonLd.map((j) => `<script data-seo type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`),
  ].join('\n    ')
}

/** the sitemap: every page worth listing, one address each */
export function sitemapXml(routes: Route[], version: string): string {
  const urls = routes.map((r) => pageSeo(r, version)).filter((s) => s.index)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((s) => `  <url><loc>${SITE}${s.path}</loc></url>`).join('\n')}\n</urlset>\n`
}
