// Caches the app shell so Label opens instantly and works offline once
// installed. Bump CACHE when the shell changes.
const CACHE = "label-202608252110";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/config.js",
  "./js/app.js",
  "./js/store.js",
  "./js/label.js",
  "./js/image.js",
  "./js/allergens.js",
  "./js/printer.js",
  "./js/notices.js",
  "./js/pdf.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // One missing file should not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Supabase and picture searches must always go to the network.
  if (url.origin !== self.location.origin) return;
  // The update check has to see the live file, never a cached copy.
  if (url.pathname.endsWith("version.json")) return;

  // Network first, so a deploy is picked up as soon as the phone is online.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html"))),
  );
});
