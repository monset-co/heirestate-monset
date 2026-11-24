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

// a push notification from the admin Worker (admin/worker/push.js): { title, body, url }
self.addEventListener("push", (e) => {
  const m = e.data?.json() ?? {};
  e.waitUntil(self.registration.showNotification(m.title ?? "Heir Estates", { body: m.body, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: m.url ?? "/" }, tag: m.url }));
});

// tapped: bring the app forward on that page, or open it
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  let url = new URL(e.notification.data?.url ?? "/", location.origin);
  url = url.origin === location.origin ? url.href : `${location.origin}/`; // only ever into the admin
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => w.url.startsWith(location.origin));
      return win ? win.navigate(url).then((w) => (w ?? win).focus()) : self.clients.openWindow(url);
    })
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
  // hashed files never change: kept copy first; one not kept at install is kept on first use
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith("/assets/")) {
            const copy = res.clone();
            e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
          }
          return res;
        })
    )
  );
});
