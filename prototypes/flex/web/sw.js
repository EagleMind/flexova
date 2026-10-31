// FlexPad Lite offline shell: cache the app on first visit, serve it from cache forever after.
const CACHE = "flexpad-lite-v1", SHELL = ["./", "index.html", "flex-viewer.js"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request))));
