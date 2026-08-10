// Bumped to v3: the document is no longer served from cache first. A cache name change is
// what evicts the old entries — without it, clients keep serving the stale shell.
const CACHE_NAME = 'xancode-os-v3';

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

// The document is fetched fresh; everything else is stale-while-revalidate.
//
// It used to be stale-while-revalidate for EVERYTHING, index.html included. Serving the cached
// copy instantly and refreshing in the background means the page you are looking at is always
// the PREVIOUS visit's build — a fix shipped today first appears on the load after next. The
// person using the app described it exactly: "we have the old old old glitch... is this time
// machine or wtf is going on". It was a time machine. Every deploy was verified byte-for-byte
// on the server and none of it could reach the screen on the first load, and any visit where
// the background refresh failed left them further behind still.
//
// Stale-while-revalidate is right for the vendored assets: they are large, they change only
// when the app is rebuilt, and a version behind for one load costs nothing. It is wrong for the
// one file that decides which version of the app you are running.
const isDocument = (request) => {
    if (request.mode === 'navigate') return true;
    const url = new URL(request.url);
    return url.origin === self.location.origin &&
           (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));
};

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    if (isDocument(event.request)) {
        // Network first, cache only as the offline fallback. Offline still works: the shell is
        // precached at install and refreshed on every successful load.
        event.respondWith((async () => {
            try {
                const fresh = await fetch(event.request);
                if (fresh && fresh.status === 200) {
                    const clone = fresh.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return fresh;
            } catch (e) {
                return (await caches.match(event.request)) ||
                       (await caches.match('./index.html')) ||
                       Response.error();
            }
        })());
        return;
    }

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
