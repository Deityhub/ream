import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' so the build also loads from file:// inside Electron
// worker format es: the worker loads each tool's engine with a dynamic import, which needs code splitting
export default defineConfig({ base: './', plugins: [react(), tailwindcss()], worker: { format: 'es' } })
