// Ream's service worker: keeps the app on the device so it opens and works with no connection. The build (the
// `serviceWorker` plugin in vite.config.ts) fills in VERSION and FILES and writes this file as dist/sw.js.
// It only ever fetches Ream's own files; Download free fonts (Fontsource) goes to the network as it always did.
const VERSION = '__VERSION__'
/** everything a tool needs, relative to the site: fetched in the background on the first visit */
const FILES = __FILES__
const APP = `ream-app-${VERSION}`
/** files kept the first time they're used (Office fonts for scripts other than Latin); the names carry a content hash, so they never go stale */
// ponytail: never pruned, so fonts of old versions stay until the browser clears storage; prune against FILES' names if it grows
const EXTRA = 'ream-extra'

self.addEventListener('install', (event) => {
  // a new version waits until the page says to switch (the "new version is ready" bar), so a running tool isn't cut off
  event.waitUntil(caches.open(APP).then((cache) => cache.addAll(FILES)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ream-app-') && k !== APP).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'switch') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    // the page itself: the newest from the network, the kept copy when offline (its own, else the app's first page: every address is a page of the app)
    event.respondWith(fetch(request).catch(() => caches.match(request, { cacheName: APP, ignoreVary: true }).then((page) => page ?? caches.match('./', { cacheName: APP, ignoreVary: true }))))
    return
  }
  // ignoreVary: a host that sends `Vary: Origin` would otherwise make every module script miss its kept copy (the page's request has an Origin header, the one that filled the cache has none); the names carry a hash, so one copy is the only copy
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then(
      (kept) =>
        kept ??
        fetch(request).then((response) => {
          if (response.ok && url.pathname.includes('/assets/')) {
            const copy = response.clone()
            event.waitUntil(caches.open(EXTRA).then((cache) => cache.put(request, copy)))
          }
          return response
        }),
    ),
  )
})
