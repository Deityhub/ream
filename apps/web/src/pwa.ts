import { useSyncExternalStore } from 'react'

// The installable, offline app: the service worker (sw.js, written by the build) and the browser's install offer.
// State lives here, outside React, because both events can fire before any component has mounted.

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let state = { update: null as ServiceWorker | null, install: null as InstallPrompt | null }
const listeners = new Set<() => void>()
const set = (patch: Partial<typeof state>) => {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function usePwa() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  )
}

/** the page is open as an installed app (its own window), not in a browser tab */
export const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

/** show the browser's own install dialog (Chrome, Edge, Android) */
export async function install() {
  const prompt = state.install
  if (!prompt) return
  await prompt.prompt()
  await prompt.userChoice
  set({ install: null }) // a prompt can be used once
}

let switching = false

/** move to the waiting version: the page reloads when the new worker has taken over */
export function switchToUpdate() {
  switching = true
  state.update?.postMessage('switch')
}

/** Start the worker (built site only: the dev server has no sw.js) and listen for the install offer. */
export function startPwa() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // offered by the page's own button, not the browser's mini bar
    set({ install: e as InstallPrompt })
  })
  addEventListener('appinstalled', () => set({ install: null }))
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => null)
    if (!reg) return
    // a worker that installs while an older one runs the page is a new version: offer it
    const watch = (w: ServiceWorker | null) => {
      if (!w) return
      const ready = () => w.state === 'installed' && navigator.serviceWorker.controller && set({ update: w })
      ready()
      w.addEventListener('statechange', ready)
    }
    watch(reg.waiting)
    reg.addEventListener('updatefound', () => watch(reg.installing))
    // look for a new version when the page comes back into view (an installed app can stay open for days)
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}))
    // only after the user chose to switch: the first worker also takes over the page (clients.claim), and that must not reload it
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!switching) return
      switching = false
      location.reload()
    })
  })
}
