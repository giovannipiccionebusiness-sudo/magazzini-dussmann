const VERSION = "1.8.31";
const CACHE_PREFIX = "magazzini-dussmann-";
const CACHE_NAME = CACHE_PREFIX + VERSION;

const FILES_TO_CACHE = [
  "./index.html",
  "./style.css?v=" + VERSION,
  "./app.js?v=" + VERSION,
  "./notifications.js?v=" + VERSION,
  "./pdf-viewer.js?v=" + VERSION,
  "./pdf-viewer.css?v=" + VERSION,
  "./ddt-push.js?v=" + VERSION,
  "./ddt-whatsapp.js?v=" + VERSION,
  "./stock-check.js?v=" + VERSION,
  "./uploaded-ddt.js?v=" + VERSION,
  "./stock-check.css?v=" + VERSION,
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
      (url.searchParams.get("v") === VERSION && /\/(notifications\.js|uploaded-ddt\.js|stock-check\.js|stock-check\.css|app\.js|ddt-push\.js|ddt-whatsapp\.js|style\.css|pdf-viewer\.js|pdf-viewer\.css)$/.test(url.pathname))) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => await cache.match(request) || fetch(request)));
  }
});

self.addEventListener("push", event => {
  let data;
  try { data = event.data.json(); } catch { return; }
  let url;
  try { url = new URL(data.url); } catch { return; }
  if (!url.href.startsWith(self.registration.scope) || (!url.searchParams.get("ordine-ddt") && !url.searchParams.get("ddt-caricato"))) return;
  event.waitUntil(Promise.all([
    self.clients.matchAll({type:"window",includeUncontrolled:true}).then(clients=>{for(const client of clients)client.postMessage({type:"DDT_NOTIFICATION_RECEIVED"});}),
    self.registration.showNotification(data.type === "ddt-uploaded" ? "Nuovo DDT caricato" : "Magazzini Dussmann", {
    body: data.body, icon: "./icons/icon-192.png", data: { url: url.href }
  })]));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url;
  if (!target || !target.startsWith(self.registration.scope)) return;
  event.waitUntil(self.clients.openWindow(target));
});
