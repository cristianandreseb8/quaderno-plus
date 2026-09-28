// Quaderno+ service worker: makes the app installable and lets it open with a weak or no
// connection. The page itself is always fetched fresh when online, built files are cached
// forever (their names change on every deploy), and recipe reads fall back to the last copy.
const VERSION = 'q1'
const SHELL = `qd-shell-${VERSION}`
const DATA = `qd-data-${VERSION}`
const FONTS = `qd-fonts-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA, FONTS].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(fallbackUrl || request, res.clone())
    return res
  } catch (err) {
    const hit = await cache.match(fallbackUrl || request)
    if (hit) return hit
    throw err
  }
}

async function cacheFirst(request, cacheName = SHELL) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  // Font stylesheets load without CORS, so their responses are opaque; keep those too.
  if (res.ok || res.type === 'opaque') cache.put(request, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // App page: fresh when online, last copy when offline.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL, '/'))
    return
  }
  // Built files and icons: hashed names, safe to keep.
  if (url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname))) {
    event.respondWith(cacheFirst(req))
    return
  }
  // Template fonts (Google Fonts): keep them, so a chosen template still looks right offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONTS))
    return
  }
  // Recipe and session reads from the database: fresh when online, last copy offline.
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/')) {
    event.respondWith(networkFirst(req, DATA))
  }
})
