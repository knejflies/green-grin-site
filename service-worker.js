const CACHE_NAME = "green-grin-app-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/portal/",
  "/employee/",
  "/admin/",
  "/manifest.webmanifest",
  "/manifest-customer.webmanifest",
  "/manifest-admin.webmanifest",
  "/manifest-employee.webmanifest",
  "/assets/green-grin-tab-icon.png",
  "/assets/green-grin-pwa-192.png",
  "/assets/green-grin-pwa-512.png",
  "/assets/green-grin-logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).pathname.startsWith("/.netlify/functions/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => null);
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
