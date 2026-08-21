const CACHE_NAME = "green-grin-public-v7";
const APP_SHELL = [
  "/",
  "/index.html",
  "/landscaping/",
  "/work/",
  "/manifest.webmanifest",
  "/assets/slides-data.js",
  "/assets/green-grin-logo.webp",
  "/assets/green-grin-favicon-96.png",
  "/assets/green-grin-caldwell-idaho-striped-lawn-mowing.webp",
  "/assets/green-grin-pwa-192.png",
  "/assets/green-grin-pwa-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => null);
    return response;
  }).catch(() => caches.match(event.request)));
});
