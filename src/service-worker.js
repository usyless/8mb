const cacheName = 'v1';

contentToCache = [
    './favicon.ico',
    './favicon.svg',

    './',
    './index.html',
    './styles.css',
    './shared.css',
    './popups.css',
    './index.js',
    './popups.js',
    './ffmpeg.js',
    './814.ffmpeg.js',
    './updater.js',

    './8mb.webmanifest',

    './ffmpeg/ffmpeg-core.js',
    './ffmpeg/ffmpeg-core.wasm',
    './ffmpeg-mt/ffmpeg-core.js',
    './ffmpeg-mt/ffmpeg-core.wasm',
    './ffmpeg-mt/ffmpeg-core.worker.js',

    './assets/fonts/open-sans-latin-400-normal.woff2',
    './assets/fonts/open-sans-latin-700-normal.woff2',
].map((c) => `${c}?version=${cacheName}`);

self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
        const cache = await caches.open(cacheName);
        await cache.addAll(contentToCache);
    })());
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cn => {
                    if (cn !== cacheName) {
                        return caches.delete(cn);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (!(req.url.startsWith('http:') || req.url.startsWith('https:'))) return;

    e.respondWith((async () => {
        return (await caches.match(req, {ignoreSearch: true})) ?? (await fetch(req));
    })());
});

self.addEventListener('message', e => {
    if (e.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});