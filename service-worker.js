const VERSION = "1.8.7";
const CACHE_PREFIX = "magazzini-dussmann-";
const CACHE_NAME = CACHE_PREFIX + VERSION;

const FILES_TO_CACHE = [
  "./index.html",
  "./style.css?v=" + VERSION,
  "./app.js?v=" + VERSION,
  "./magazzino-home.webp?v=" + VERSION,
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(FILES_TO_CACHE.map(url => new Request(url, { cache: "reload" })))
  ));
});

self.addEventListener("message", event => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || !url.href.startsWith(self.registration.scope)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { cache: "no-cache" }).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match("./index.html") || Response.error();
    }));
  } else if (url.pathname.endsWith("/magazzino-home.webp") ||
      (url.searchParams.get("v") === VERSION && /\/(app\.js|style\.css)$/.test(url.pathname))) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => await cache.match(request) || fetch(request)));
  }
});
