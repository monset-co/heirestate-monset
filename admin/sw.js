// The admin's service worker, as the Monset dashboard's: vite.admin.config.js fills in VERSION and
// ASSETS at build and emits it as /sw.js. It keeps the app's own files for opening fast and offline,
// and never touches Supabase or /api (other origin, or the Worker), so data is always live.
const VERSION = "__VERSION__";
const ASSETS = __ASSETS__;
const CACHE = `heir-admin-${VERSION}`;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // pages: network first, so a deploy shows at once; the kept shell when offline
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }
  // hashed files never change: kept copy first
  e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
});
