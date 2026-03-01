// Pixel Agents Service Worker — cache-first for static assets, network-first for API
const CACHE_NAME = 'pixel-agents-v1'
const STATIC_EXTENSIONS = ['.js', '.css', '.png', '.woff', '.woff2', '.ttf', '.json']

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip non-GET, socket.io, and API requests
  if (event.request.method !== 'GET') return
  if (url.pathname.startsWith('/socket.io')) return
  if (url.pathname.startsWith('/api/')) return

  // Static assets: cache-first
  const isStatic = STATIC_EXTENSIONS.some((ext) => url.pathname.endsWith(ext))
  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
      })
    )
    return
  }

  // HTML pages: network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
      .catch(() => caches.match(event.request))
  )
})
