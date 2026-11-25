// GhostPacket offline service worker. Same-origin only; never contacts another host.
// - Pages: network first (fresh deploys win), cache fallback when offline.
// - Hashed Next.js assets (`_next/static`): cache first (immutable).
// - Other assets (WASM, worklet, fonts, icons): stale-while-revalidate.
const VERSION = "ghostpacket-v2";
const SCOPE = new URL(self.registration.scope);
const BASE = SCOPE.pathname.replace(/\/$/, "");
const SHELL = ["/", "/how-it-works/", "/simulation/", "/test/", "/wasm/ghostpacket_core_bg.wasm", "/worklets/capture-processor.js", "/manifest.json", "/icon.svg"].map(
  (p) => BASE + p,
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ghostpacket-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function store(request, response) {
  if (response && response.ok && response.type === "basic") {
    const copy = response.clone();
    caches.open(VERSION).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(BASE + "/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((r) => store(request, r))
        .catch(async () => (await caches.match(request, { ignoreSearch: true })) || (await caches.match(BASE + "/")) || Response.error()),
    );
    return;
  }

  if (url.pathname.includes("/_next/static/")) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((r) => store(request, r))));
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((r) => store(request, r))
        .catch(() => hit || Response.error());
      return hit || network;
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "status") {
    caches
      .open(VERSION)
      .then((c) => c.keys())
      .then((keys) => event.source && event.source.postMessage({ type: "status", cached: keys.length, version: VERSION }));
  }
});
