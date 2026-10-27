import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** the licence and the third-party notices go out with the site, linked from the footer */
const legal = (): Plugin => ({
  name: 'ream-legal',
  apply: 'build',
  generateBundle() {
    for (const [from, to] of [['LICENSE', 'license.txt'], ['THIRD-PARTY-NOTICES.md', 'third-party-notices.txt']]) {
      this.emitFile({ type: 'asset', fileName: to, source: readFileSync(new URL(`../../${from}`, import.meta.url), 'utf8') })
    }
  },
})

// base './': asset paths are relative, so the build works from any folder of any static host
// worker format es: the worker loads each tool's engine with a dynamic import, which needs code splitting
export default defineConfig({ base: './', plugins: [react(), tailwindcss(), legal()], worker: { format: 'es' } })
