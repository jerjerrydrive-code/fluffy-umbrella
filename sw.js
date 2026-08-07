// Bumped to v2: the app shell moved from CDNs to ./vendor. A cache name change is what
// evicts the old entries — without it, clients keep serving the stale CDN-era shell.
const CACHE_NAME = 'xancode-os-v2';

// Every entry is same-origin now. That matters beyond tidiness: cache.add() on a cross-origin
// URL yields an opaque response, which cannot be inspected for success, so a failed CDN fetch
// used to be cached as a "win" and silently served an empty script forever after. Same-origin
// responses fail loudly and correctly instead.
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png',
    './vendor/tailwind.css',
    './vendor/lucide.min.js',
    './vendor/bwip-js.min.js',
    './vendor/html5-qrcode.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => Promise.all(
                APP_SHELL.map((url) => cache.add(url).catch(() => {}))
            ))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Stale-while-revalidate: serve from cache instantly, refresh in the background,
// fall back to cache if the network is unavailable (offline support).
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const clone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return networkResponse;
            }).catch(() => cached);

            return cached || fetchPromise;
        })
    );
});
