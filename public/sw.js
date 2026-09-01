/*
 * BlueEconomy ministry portal service worker.
 * - Precaches the offline app shell (install).
 * - Navigations: network-first, falling back to the cached shell when offline.
 * - Same-origin static assets: cache-first with runtime cache fill.
 * - Everything else (API calls, runtime configuration, cross-origin):
 *   network-only. Live KPI data is never served from cache.
 */
const VERSION = "v1";
const SHELL_CACHE = `ministry-portal-shell-${VERSION}`;
const RUNTIME_CACHE = `ministry-portal-runtime-${VERSION}`;

const APP_SHELL = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return; // network-only
  }
  if (url.pathname.startsWith("/v1/") || url.pathname === "/platform-config.json") {
    return; // live data and deployment configuration are never cached
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("/index.html");
          return cached ?? caches.match("/");
        }),
    );
    return;
  }

  // Same-origin static assets: cache-first with runtime fill.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached !== undefined) {
        return cached;
      }
      return fetch(request).then((response) => {
        if (response.ok && (url.pathname.startsWith("/assets/") || url.pathname.endsWith(".png") || url.pathname.endsWith(".json"))) {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
