/* Minutes — service worker
   Strategy:
   - Navigations: network-first (so new app versions flow through), cached under
     their OWN url, fall back to cache only when offline.
   - Query-string requests (the pull-to-refresh version poll): network only.
   - Other same-origin static assets (icons, manifest, svg): cache-first.
   - Cross-origin (Firebase, gstatic, reCAPTCHA): passthrough, never cached. */
var CACHE = "minutes-v11";  // bumped whenever the cached shell changes; verify-update.py reads this name
var CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon.svg",
  "./icons/favicon.svg",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(CORE.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  // Cross-origin (Firebase / Google) — let the network handle it untouched.
  if (!sameOrigin) return;

  // Anything with a query string goes straight to the network and is never
  // stored. This is what the pull-to-refresh version poll rides on: that poll is
  // a same-origin GET for the app document, but it is NOT mode:"navigate", so
  // without this it falls into the cache-first branch below and gets answered out
  // of Cache Storage. `cache: "no-store"` does not save it either, because that
  // only bypasses the HTTP cache, not the Cache API.
  if (url.search) return;

  var isNav = req.mode === "navigate" ||
    (req.headers.get("accept") || "").indexOf("text/html") !== -1;

  if (isNav) {
    // network-first so version bumps are picked up; cache fallback when offline
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        // Cache under the url that was actually requested. v2 hardcoded
        // "./index.html" here, so a second page opened alongside the shell
        // overwrote the shell's offline copy with its own markup, and every
        // later request for ./index.html, including the update poll, was
        // answered with the wrong document. The app is a single page again, but
        // "./" and "./index.html" are still two distinct cache keys, so the
        // per-url form stays correct.
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (m) {
          return m || caches.match("./index.html");
        });
      })
    );
    return;
  }

  // static same-origin asset — cache-first, then network (and cache it)
  e.respondWith(
    caches.match(req).then(function (m) {
      return m || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return m; });
    })
  );
});
