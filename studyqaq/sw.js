/* Study QAQ PWA service worker: shell cache-first, data network-first.
   Firebase / Google API traffic is never intercepted.
   version.json is NEVER cached: the page's open-time version check
   (see index.html) must always see the live published build. */
var CACHE = 'studyqaq-v9';
var SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'manifest.webmanifest',
  'icon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Fetch the shell bypassing the HTTP cache so a new worker never
      // populates its cache with the previous build's files.
      return Promise.all(SHELL.map(function (u) {
        return fetch(u, { cache: 'no-store' }).then(function (resp) {
          if (!resp.ok) throw new Error('shell fetch failed: ' + u);
          return c.put(u, resp);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// The page's one-click update asks a waiting worker to take over now.
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Never touch Firebase / Google APIs or the AI endpoint: always live.
  if (url.hostname !== self.location.hostname) return;
  // Version check file: network only, never served from (or written to)
  // any cache, so an old build always learns the live build number.
  if (url.pathname.indexOf('version.json') >= 0) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(function () {
        return new Response('{}', {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }
  // Announcements: network-first so patrol updates show up promptly.
  if (url.pathname.indexOf('announcements.json') >= 0) {
    e.respondWith(
      fetch(e.request).then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return resp;
      }).catch(function () { return caches.match(e.request); })
    );
    return;
  }
  // Shell + stickers: cache-first.
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return resp;
      });
    })
  );
});
