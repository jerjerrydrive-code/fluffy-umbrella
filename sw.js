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

// Without these the app cannot run offline at all. The icons and the manifest are a degraded
// experience; these are the difference between working and a blank screen.
const CRITICAL = [
    './index.html',
    './vendor/tailwind.css',
    './vendor/lucide.min.js',
    './vendor/bwip-js.min.js',
    './vendor/html5-qrcode.min.js'
];

self.addEventListener('install', (event) => {
    // Every failure used to be swallowed by `.catch(() => {})`, so a renamed or missing vendor
    // file installed a worker that could not serve the app offline and said nothing about it.
    // The whole point of this worker is offline, so it is better to refuse to install and leave
    // the previous one in place than to activate one that quietly cannot do its job. Non-critical
    // entries are still allowed to fail: a missing icon is not worth losing offline support over.
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        const failed = [];
        await Promise.all(APP_SHELL.map(async (url) => {
            try { await cache.add(url); } catch (e) { failed.push(url); }
        }));

        if (failed.length) console.warn('[XanOS SW] could not cache:', failed.join(', '));

        const lost = failed.filter((url) => CRITICAL.includes(url));
        if (lost.length) throw new Error('app shell incomplete: ' + lost.join(', '));

        await self.skipWaiting();
    })());
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
