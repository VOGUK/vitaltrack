const CACHE_NAME = 'vitaltrack-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/VitalTrack-Logo.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    // Don't cache API calls
    if (event.request.url.includes('api.php')) return;

    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request))
    );
});