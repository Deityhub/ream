import type { OutputAsset } from 'rollup'
import type { Plugin } from 'vite'
import { tools } from '@ream/tools'
import { allRoutes, pathOf, type Route } from './src/routes'
import { headTags, pageSeo, sitemapXml, type PageSeo } from './src/seo'

/**
 * Writes a page for every route (tool/merge-pdf/index.html and so on), a 404 page and sitemap.xml, from the built index.html:
 * each has its own title, description, canonical address, social card tags and structured data in the head, and plain
 * text inside #root that the app replaces when it starts. Search engines and link previews read these files; the app
 * works the same from any of them.
 */
export const seoPages = (version: string): Plugin => ({
  name: 'ream-seo',
  apply: 'build',
  generateBundle: {
    order: 'post',
    handler(_, bundle) {
      const index = bundle['index.html'] as OutputAsset | undefined
      if (!index) throw new Error('ream-seo: the build has no index.html to start from')
      const template = String(index.source)
      const page = (s: PageSeo) => {
        const head = `<title>${escapeText(s.title)}</title>`
        let html = template.replace(/<title>[^<]*<\/title>/, head).replace(/(<meta name="description" content=")[^"]*(")/, `$1${escapeAttr(s.description)}$2`)
        html = html.replace('</head>', `    ${headTags(s)}\n  </head>`).replace('<div id="root"></div>', `<div id="root">${s.html}</div>`)
        if (html === template) throw new Error('ream-seo: the template has nothing to fill in')
        return html
      }
      const emit = (fileName: string, source: string) => this.emitFile({ type: 'asset', fileName, source })
      const routes: Route[] = allRoutes(tools)
      for (const route of routes) {
        const file = pathOf(route) === '/' ? 'index.html' : `${pathOf(route).slice(1)}index.html`
        if (file === 'index.html') index.source = page(pageSeo(route, version))
        else emit(file, page(pageSeo(route, version)))
      }
      emit('404.html', page(pageSeo({ page: 'notFound' }, version)))
      emit('sitemap.xml', sitemapXml(routes, version))
    },
  },
})

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;')
