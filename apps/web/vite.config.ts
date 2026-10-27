import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './': asset paths are relative, so the build works from any folder of any static host
// worker format es: the worker loads each tool's engine with a dynamic import, which needs code splitting
export default defineConfig({ base: './', plugins: [react(), tailwindcss()], worker: { format: 'es' } })
