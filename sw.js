// Bump CACHE_VERSION on every deploy so installed clients pick up new files.
const CACHE_VERSION = 'v41';
const CACHE = `life-os-${CACHE_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './utils.js',
  './state.js',
  './sync.js',
  './shell.js',
  './views/today.js',
  './views/body.js',
  './views/training.js',
  './views/nutrition.js',
  './views/bjj.js',
  './views/money.js',
  './views/growth.js',
  './views/social.js',
  './views/explore.js',
  './views/review.js',
  './views/coach.js',
  './views/mentor.js',
  './views/settings.js',
  './main.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  // D10 fix: cache.addAll() is atomic — one renamed/missing asset would silently
  // fail the ENTIRE install, permanently blocking offline support for every user
  // until fixed and redeployed. Caching each asset independently means a single
  // bad entry is logged and skipped rather than taking down the whole install;
  // the cache/version strategy itself (CACHE_VERSION, cache-first fetch) is unchanged.
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(ASSETS.map(url =>
        c.add(url).catch(err => console.warn('Life OS SW: failed to precache', url, err))
      ))
    )
  );
});

self.addEventListener('activate', e => {
  // Auth-safety note (verified, not just asserted): this only ever deletes old
  // entries from the Cache Storage API (caches.keys()/.delete()) — the versioned
  // ASSETS caches above. The Supabase session lives in localStorage (persistSession),
  // a completely separate browser storage area a service worker cannot see or
  // touch from here. A cache-version bump / SW update can therefore never clear,
  // rotate, or otherwise affect authentication state.
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Same network-fallback strategy as before: try cache first, fall back to network.
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
