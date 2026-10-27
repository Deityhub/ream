// Headless Google Chrome over the DevTools protocol, for checks and dev scripts (render-compare, fixtures, driving the
// built app). No dependency: Chrome is the one installed on the machine (CHROME overrides the path) and Node 22's own
// WebSocket talks to it. Each run gets a throwaway profile.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Pending = Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>

/** one DevTools connection (a page or the browser): `send` a method, get its result */
async function connect(url: string) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error(`can't connect to ${url}`))
  })
  let id = 0
  const pending: Pending = new Map()
  const listeners: ((method: string, params: any) => void)[] = []
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data))
    if (d.id !== undefined) {
      const p = pending.get(d.id)
      pending.delete(d.id)
      if (d.error) p?.reject(new Error(`${d.error.message}${d.error.data ? `: ${d.error.data}` : ''}`))
      else p?.resolve(d.result)
    } else for (const l of listeners) l(d.method, d.params)
  }
  return {
    send: (method: string, params: object = {}): Promise<any> =>
      new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      }),
    on: (l: (method: string, params: any) => void) => listeners.push(l),
    close: () => ws.close(),
  }
}

export type Page = Awaited<ReturnType<typeof openPage>>

async function openPage(port: number, url: string) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURI(url)}`, { method: 'PUT' })).json()
  const c = await connect(target.webSocketDebuggerUrl)
  await c.send('Page.enable')
  await c.send('Runtime.enable')
  return {
    ...c,
    /** run an expression in the page (promises are awaited) and return its JSON value; page errors throw */
    async evaluate<T = unknown>(expression: string): Promise<T> {
      const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value as T
    },
    async goto(to: string, settle = 500) {
      await c.send('Page.navigate', { url: to })
      for (let i = 0; i < 200; i++) {
        await sleep(50)
        const r = await c.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }).catch(() => null)
        if (r?.result?.value === 'complete') break
      }
      await sleep(settle)
    },
    async screenshot(path: string) {
      writeFileSync(path, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    },
    /** viewport size and colour scheme, as a phone or a desktop shows the page */
    async view(width: number, height: number, scheme: 'light' | 'dark' = 'light') {
      await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 })
      await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
    },
    /** put local files into a file input, as if picked by hand: how checks get files into a page served from localhost */
    async setFiles(selector: string, files: string[]) {
      const { root } = await c.send('DOM.getDocument')
      const { nodeId } = await c.send('DOM.querySelector', { nodeId: root.nodeId, selector })
      if (!nodeId) throw new Error(`no element matches ${selector}`)
      await c.send('DOM.setFileInputFiles', { nodeId, files })
    },
    async pdf(path: string, options: object = {}) {
      writeFileSync(path, Buffer.from((await c.send('Page.printToPDF', options)).data, 'base64'))
    },
  }
}

/** start Chrome; `headless: false` shows the window (to watch a check) */
export async function openChrome(options: { headless?: boolean } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'ream-chrome-'))
  const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', 'about:blank']
  if (options.headless !== false) args.unshift('--headless=new')
  const proc = spawn(CHROME, args, { stdio: 'ignore' })
  let port = 0
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100)
    try {
      port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0])
    } catch {
      // not written yet
    }
  }
  if (!port) {
    proc.kill()
    throw new Error(`Chrome didn't start (looked for it at ${CHROME}; set CHROME to its path)`)
  }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const browser = await connect(version.webSocketDebuggerUrl)
  return {
    port,
    page: (url = 'about:blank') => openPage(port, url),
    /** grant permissions (such as 'localFonts') to an origin without the prompt */
    grant: (origin: string, permissions: string[]) => browser.send('Browser.grantPermissions', { origin, permissions }),
    async close() {
      await browser.send('Browser.close').catch(() => {})
      browser.close()
      proc.kill()
      await sleep(200)
      rmSync(profile, { recursive: true, force: true })
    },
  }
}
