const CACHE_PREFIX = "stock-ledger-";
const CACHE_NAME = `${CACHE_PREFIX}v17`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./stocks.js",
  "./prices.js",
  "./prices.json",
  "./scripts/config.js",
  "./scripts/stock-lookup.js",
  "./scripts/calculator.js",
  "./scripts/demo-data.js",
  "./scripts/portfolio.js",
  "./scripts/ledger-model.js",
  "./scripts/storage.js",
  "./scripts/market-data.js",
  "./scripts/csv.js",
  "./scripts/records-view.js",
  "./scripts/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // 行情檔採 network-first，才能拿到新版；失敗時只退回行情快取，絕不影響帳本頁面。
  if (url.origin === self.location.origin && url.pathname.endsWith("/prices.json")) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match("./index.html")))
  );
});
