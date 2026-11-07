#!/bin/bash
# Builds the Tagbook app into site/ (what Cloudflare serves). Usage: ./build.sh
set -e
cd "$(dirname "$0")"
B=$(date -u +%Y%m%d%H%M%S)
rm -rf site && mkdir -p site/font
npx esbuild src/app.js --bundle --minify --format=iife --target=es2019 --outfile=site/app.js --log-level=warning
node --check site/app.js
cp src/font/*.woff2 src/font/plex.css site/font/
cp icon-192.png icon-512.png apple-touch-icon.png robots.txt site/
GEAR=$(cat src/gear.html)
cat > site/index.html <<HTML
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#0F7B5F">
<title>Tagbook</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Tagbook">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="stylesheet" href="/font/plex.css">
<script>window.TB_BUILD="$B";</script>
<style>
$(cat src/style.css)
$(cat src/extra.css)
</style>
</head><body>
<div id="installbar" class="installbar" hidden></div>
<div id="offline" class="offline" hidden>You're offline. Changes won't save until you're back online.</div>
<div id="login" class="login" hidden></div>
<div class="app" id="app" hidden>
  <header>
    <div class="brand"><span id="shopname"></span><small>Tagbook</small></div>
    <div class="hdr-r"><button id="themebtn" class="gear" type="button"></button>$GEAR</div>
  </header>
  <section id="view"></section>
</div>
<nav class="tabs" id="tabsnav" hidden><div class="inner" id="tabs"></div></nav>
<div id="sheet" class="sheet" hidden></div>
<div id="toast" class="toast" hidden></div>
<script src="/app.js?v=$B"></script>
<script>if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));}</script>
<script>
$(cat src/live.js)
</script>
</body></html>
HTML
cat > site/manifest.webmanifest <<'JSON'
{
  "name": "Tagbook",
  "short_name": "Tagbook",
  "description": "Every cloth, accounted for.",
  "start_url": "/#orders",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#F3F5F3",
  "theme_color": "#0F7B5F",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
JSON
cat > site/sw.js <<SW
// Tagbook service worker: installable app; the app shell opens offline. Data always comes from the network.
const CACHE = "tagbook-$B";
const FILES = ["/", "/index.html", "/app.js?v=$B", "/manifest.webmanifest", "/icon-192.png", "/font/plex.css"];
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
SW
printf '{"v":"%s"}\n' "$B" > site/version.json
printf '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n/sw.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n' > site/_headers
echo "built $B"
