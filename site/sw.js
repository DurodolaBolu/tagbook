// Tagbook service worker: installable app; the app shell opens offline. Data always comes from the network.
const CACHE = "tagbook-20261114132230";
const FILES = ["/", "/index.html", "/app.js?v=20261114132230", "/manifest.webmanifest", "/icon-192.png", "/font/plex.css"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || u.pathname === "/version.json") return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("/index.html"))));
});
// Push: show the owner's notification; tapping it opens that order
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Tagbook", { body: d.body || "", tag: d.tag, data: { url: d.url || "/#orders" }, icon: "/icon-192.png", badge: "/icon-192.png", renotify: true }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/#orders";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if (new URL(w.url).origin === location.origin) { w.focus(); return w.navigate ? w.navigate(url) : null; } }
    return clients.openWindow(url);
  }));
});
