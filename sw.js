const CACHE_PREFIX = "jazz2-cache-";
const CACHE_NAME = `${CACHE_PREFIX}v151`;
const ASSETS = [
  "./index.html",
  "./jazz2.0.html",
  "./css/app.css",
  "./js/theme.js",
  "./js/constants.js",
  "./js/core.js",
  "./js/defaults.js",
  "./js/modal.js",
  "./js/todo-dates.js",
  "./js/holidays.js",
  "./js/home.js",
  "./js/jarvis.js",
  "./js/dashboard.js",
  "./js/push.js",
  "./js/composer.js",
  "./js/todo.js",
  "./js/skin.js",
  "./js/shopping.js",
  "./js/budget-bills.js",
  "./js/budget-income.js",
  "./js/budget-goals.js",
  "./js/budget-import.js",
  "./js/budget-view.js",
  "./js/fitness.js",
  "./js/jazz3.js",
  "./js/console.js",
  "./js/review.js",
  "./js/calendar.js",
  "./js/ask.js",
  "./js/voice.js",
  "./js/shell.js",
  "./js/gestures.js",
  "./js/drag-reorder.js",
  "./js/sync.js",
  "./js/backup.js",
  "./js/data-load.js",
  "./js/import-link.js",
  "./js/pwa.js",
  "./js/boot.js",
  "./manifest.json",
  "./jarvis-icon-192.png",
  "./jarvis-badge-96.png",
  "./jarvis-icon-512.png",
  "./fonts/inter-latin-var.woff2",
  "./fonts/rajdhani-500.woff2",
  "./fonts/rajdhani-600.woff2",
  "./fonts/rajdhani-700.woff2",
  "./fonts/share-tech-mono-400.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const results = await Promise.allSettled(
        ASSETS.map((url) =>
          fetch(url, { cache: "reload" }).then((res) => {
            if (!res.ok) throw new Error(url + " " + res.status);
            return cache.put(url, res);
          }),
        ),
      );
      const failed = results.find((result) => result.status === "rejected");
      if (failed) {
        await caches.delete(CACHE_NAME);
        throw failed.reason;
      }
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

function isAppShellRequest(request) {
  return (
    request.mode === "navigate" ||
    request.destination === "document" ||
    request.url.endsWith("/jazz2.0.html") ||
    request.url.endsWith("/index.html")
  );
}

self.addEventListener("fetch", (event) => {
  // Never intercept cross-origin requests (e.g. the GitHub API used for gist
  // sync) — the cache-first branch below would serve stale sync data forever.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;
  if (isAppShellRequest(event.request)) {
    // Network-first for the HTML shell so a normal reload always picks up the
    // latest deploy instead of getting stuck on whatever was cached at install.
    const networkResponse = fetch(event.request);
    event.waitUntil(
      networkResponse
        .then(
          (response) => {
            if (!response || !response.ok) return;
            return caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          },
          () => {},
        )
        .catch((error) => console.error("app shell cache update failed", error)),
    );
    event.respondWith(
      networkResponse
        // ?tab=… launch shortcuts must find the cached page offline too
        .catch(() =>
          caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || caches.match("./jazz2.0.html")),
        ),
    );
    return;
  }
  const networkResponse = fetch(event.request);
  event.waitUntil(
    networkResponse
      .then(
        (response) => {
          if (!response || !response.ok) return;
          return caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        },
        () => {},
      )
      .catch((error) => console.error("asset cache update failed", error)),
  );
  event.respondWith(caches.match(event.request).then((cached) => cached || networkResponse.catch(() => cached)));
});

// Phone notifications from Jarvis (js/push.js). The payload is plain data from the Jarvis
// Action; it's capped and the link is kept inside the app.
self.addEventListener("push", (event) => {
  let m = {};
  try {
    m = event.data ? event.data.json() : {};
  } catch (e) {}
  const text = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  const url = typeof m.url === "string" && m.url.startsWith("./") ? m.url : "./jazz2.0.html?tab=jarvis";
  event.waitUntil(
    self.registration.showNotification(text(m.title, 60) || "Jarvis", {
      body: text(m.body, 240),
      tag: text(m.tag, 30) || "jarvis",
      badge: "./jarvis-badge-96.png",
      data: { url },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || "./jazz2.0.html?tab=jarvis",
    self.registration.scope,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      if (open)
        return open.navigate(url).then(
          (c) => (c || open).focus(),
          () => open.focus(),
        );
      return self.clients.openWindow(url);
    }),
  );
});
