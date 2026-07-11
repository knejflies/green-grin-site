const CACHE_NAME = "green-grin-app-v6";
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

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_error) {
    payload = { title: "Green Grin update", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Green Grin update";
  const options = {
    body: payload.body || "",
    icon: "/assets/green-grin-pwa-192.png",
    badge: "/assets/green-grin-tab-icon.png",
    tag: payload.tag || "green-grin-update",
    data: { url: payload.url || "/portal/" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/portal/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === url && "focus" in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
