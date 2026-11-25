// Service worker registration and the AIR-GAP READY / OFFLINE badge state.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export type AirGapState = "online" | "ready" | "offline-active" | "offline-uncached";

export async function registerServiceWorker(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  if (process.env.NODE_ENV !== "production") return false;
  try {
    await navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` });
    return true;
  } catch {
    return false;
  }
}

export function airGapState(): AirGapState {
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const controlled = typeof navigator !== "undefined" && "serviceWorker" in navigator && !!navigator.serviceWorker.controller;
  if (online) return controlled ? "ready" : "online";
  return controlled ? "offline-active" : "offline-uncached";
}

export function onAirGapChange(fn: (s: AirGapState) => void): () => void {
  const update = () => fn(airGapState());
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  navigator.serviceWorker?.addEventListener("controllerchange", update);
  void navigator.serviceWorker?.ready.then(update);
  update();
  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
    navigator.serviceWorker?.removeEventListener("controllerchange", update);
  };
}
