/* HokiePark service worker. __VERSION__ is stamped by scripts/build/build.ts (hash of index.html), so every
 * new build gets a fresh cache and old ones are deleted on activate. The app is one HTML file, so
 * "offline" just means: once loaded, it opens and works with no network. */
const CACHE = "hokiepark-__VERSION__";
const PRECACHE = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("hokiepark-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    // Network-first so a fresh deploy shows up; fall back to the cached shell offline.
    event.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("index.html", copy)); return res; }).catch(() => caches.match("index.html")));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
