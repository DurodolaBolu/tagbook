// Tagbook service worker: installable app; the app shell opens offline. Data always comes from the network.
const CACHE = "tagbook-20261106021649";
const FILES = ["/", "/index.html", "/app.js?v=20261106021649", "/manifest.webmanifest", "/icon-192.png", "/font/plex.css"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || u.pathname === "/version.json") return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("/index.html"))));
});
