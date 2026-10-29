const cacheName = 'v46';

const contentToCache = [
    './favicon.ico',
    './favicon.svg',

    './',
    './index.html',
    './styles.css',
    './shared.css',
    './popup.css',
    './bundle.js',
    './worker.js',

    './8mb.webmanifest',

    './assets/fonts/open-sans-latin-400-normal.woff2',
    './assets/fonts/open-sans-latin-700-normal.woff2',
    './assets/progress.svg'
].map((c) => `${c}?version=${cacheName}`);

self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
        const cache = await caches.open(cacheName);
        await Promise.allSettled(contentToCache.map(url => cache.add(url)));
    })());
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.allSettled(
            cacheNames
                .filter(cn => cn !== cacheName)
                .map(cn => caches.delete(cn))
        );
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (!(req.url.startsWith('http:') || req.url.startsWith('https:'))) return;

    e.respondWith((async () => {
        let r = await caches.match(req, {ignoreSearch: true});
        if (!r) {
            r = await fetch(req);
            if (req.method === 'GET' && r.status === 200) {
                try {
                    const cache = await caches.open(cacheName);
                    await cache.put(req, r.clone());
                } catch (err) {
                    console.warn('Failed to cache resource:', req.url, err);
                }
            }
        }

        const headers = new Headers(r.headers);
        headers.set("Cross-Origin-Embedder-Policy", "require-corp");
        headers.set("Cross-Origin-Opener-Policy", "same-origin");

        return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
    })());
});

self.addEventListener('message', e => {
    if (e.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});