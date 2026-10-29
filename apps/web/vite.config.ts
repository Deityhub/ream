import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { seoPages } from './seoPlugin'

/** the release version (root package.json), shown in the footer and in the offline cache's name */
const VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

/** Office look-alike fonts for scripts other than Latin: 2.7 MB nobody needs up front, kept by the worker when first used */
const LATER = /^assets\/(carlito|caladea|arimo|tinos|cousine)-(?!latin(-ext)?-\d)/

/** not kept for offline use: the worker itself, Cloudflare's headers file, what crawlers read, the 404 page and the social card */
const NOT_KEPT = /^(sw\.js|_headers|robots\.txt|sitemap\.xml|404\.html|og\.png)$/

/**
 * Writes dist/sw.js from sw.js with the list of files to keep offline and a version that changes with any of them.
 * Done after the build is written, so it lists every file, the tools' workers included.
 */
const serviceWorker = (): Plugin => {
  let out = ''
  return {
    name: 'ream-service-worker',
    apply: 'build',
    configResolved(c) {
      out = c.build.outDir
    },
    closeBundle() {
      const files: string[] = []
      const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(join(dir, e.name))
          else files.push(relative(out, join(dir, e.name)).split('\\').join('/'))
        }
      }
      walk(out)
      // woff is only a fallback for browsers without woff2; _headers is Cloudflare's, not the site's; the files for crawlers and the 404 page are no use offline
      const keep = files.filter((f) => !NOT_KEPT.test(f) && !f.endsWith('.woff') && !LATER.test(f)).sort()
      const hash = createHash('sha256')
      for (const f of keep) hash.update(f).update(readFileSync(join(out, f)))
      // a page is kept under its folder's address ('./', 'tool/merge-pdf/'): Cloudflare Pages answers .../index.html with a redirect, and a page can't load from a kept redirect
      const addresses = keep.map((f) => (f === 'index.html' ? './' : f.endsWith('/index.html') ? f.slice(0, -'index.html'.length) : f))
      const template = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
      writeFileSync(join(out, 'sw.js'), template.replace("'__VERSION__'", JSON.stringify(`${VERSION}-${hash.digest('hex').slice(0, 8)}`)).replace('__FILES__', JSON.stringify(addresses)))
    },
  }
}

// base '/': every page has its own folder (/tool/merge-pdf/), so assets are found from the site's root; the site is served from a domain's root on Cloudflare and in the Docker image
// worker format es: the worker loads each tool's engine with a dynamic import, which needs code splitting
export default defineConfig({ base: '/', define: { __APP_VERSION__: JSON.stringify(VERSION) }, plugins: [react(), tailwindcss(), seoPages(VERSION), serviceWorker()], worker: { format: 'es' } })
