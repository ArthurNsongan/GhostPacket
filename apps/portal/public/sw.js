// GhostPacket offline service worker. Same-origin only; never contacts another host.
// - Pages: network first (fresh deploys win), cache fallback when offline.
// - Hashed Next.js assets (`_next/static`): cache first (immutable).
// - Other assets (WASM, worklet, fonts, icons): stale-while-revalidate.
// Each app of the skeleton ships this file with its own APP, ROUTES and NESTED.
const APP = "portal";
const ROUTES = ["/", "/how-it-works/", "/simulation/", "/test/"];
/** Sub-paths served by other apps (their own worker and cache). */
const NESTED = ["/clinic/", "/tontine/"];

const VERSION = `gp-${APP}-v3`;
const SCOPE = new URL(self.registration.scope);
const BASE = SCOPE.pathname.replace(/\/$/, "");
const SHELL = [...ROUTES, "/wasm/ghostpacket_core_bg.wasm", "/worklets/capture-processor.js", "/manifest.json", "/icon.svg"].map((p) => BASE + p);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  // Only this app's old caches (and the V2 "ghostpacket-*" ones for the portal).
  const old = (k) => (k.startsWith(`gp-${APP}-`) || (APP === "portal" && k.startsWith("ghostpacket-"))) && k !== VERSION;
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter(old).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function store(key, response) {
  if (response && response.ok && response.type === "basic") {
    const copy = response.clone();
    caches.open(VERSION).then((cache) => cache.put(key, copy));
  }
  return response;
}

/** Only this app's cache: never a response another page of the origin put elsewhere. */
const mine = (key) => caches.open(VERSION).then((c) => c.match(key));

function networkFirst(key, request) {
  return fetch(request)
    .then((r) => store(key, r))
    .catch(async () => (await mine(key)) || Response.error());
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(BASE + "/")) return;
  // Other apps of the skeleton (with or without the trailing slash) have their own worker.
  if (NESTED.some((n) => url.pathname === BASE + n.slice(0, -1) || url.pathname.startsWith(BASE + n))) return;

  if (request.mode === "navigate") {
    // Cache pages without their query string, so the cache does not grow per URL variant.
    const key = url.origin + url.pathname;
    event.respondWith(
      fetch(request)
        .then((r) => store(key, r))
        .catch(async () => (await mine(key)) || (await mine(BASE + "/")) || Response.error()),
    );
    return;
  }

  if (url.pathname.includes("/_next/static/")) {
    event.respondWith(mine(request).then((hit) => hit || fetch(request).then((r) => store(request, r))));
    return;
  }

  // Unhashed binaries must match the hashed glue of the current deploy: network first.
  if (url.pathname.endsWith(".wasm") || url.pathname.endsWith("/capture-processor.js")) {
    event.respondWith(networkFirst(request, request));
    return;
  }

  event.respondWith(
    mine(request).then((hit) => {
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
