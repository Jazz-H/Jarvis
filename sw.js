const CACHE_NAME = "jazz2-cache-v11";
const ASSETS = [
  "./index.html",
  "./jazz2.0.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((url) => fetch(url, {cache:"reload"}).then((res) => cache.put(url, res))))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isAppShellRequest(request){
  return request.mode === "navigate" || request.destination === "document" ||
    request.url.endsWith("/jazz2.0.html") || request.url.endsWith("/index.html");
}

self.addEventListener("fetch", (event) => {
  if (isAppShellRequest(event.request)){
    // Network-first for the HTML shell so a normal reload always picks up the
    // latest deploy instead of getting stuck on whatever was cached at install.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200){
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
