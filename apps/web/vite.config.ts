import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Office look-alike fonts for scripts other than Latin: 2.7 MB nobody needs up front, kept by the worker when first used */
const LATER = /^assets\/(carlito|caladea|arimo|tinos|cousine)-(?!latin(-ext)?-\d)/

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
      // woff is only a fallback for browsers without woff2; _headers is Cloudflare's, not the site's
      const keep = files.filter((f) => f !== 'sw.js' && f !== '_headers' && !f.endsWith('.woff') && !LATER.test(f)).sort()
      const hash = createHash('sha256')
      for (const f of keep) hash.update(f).update(readFileSync(join(out, f)))
      // the page is kept as './': Cloudflare Pages answers index.html with a redirect to /, and a page can't load from a kept redirect
      keep[keep.indexOf('index.html')] = './'
      const template = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
      writeFileSync(join(out, 'sw.js'), template.replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12))).replace('__FILES__', JSON.stringify(keep)))
    },
  }
}

// base './': asset paths are relative, so the build works from any folder of any static host
// worker format es: the worker loads each tool's engine with a dynamic import, which needs code splitting
export default defineConfig({ base: './', plugins: [react(), tailwindcss(), serviceWorker()], worker: { format: 'es' } })
