// Key-value storage used by the ledger, keyring, proof outbox and settings.
// Defaults to `localStorage` when available (browser), otherwise to memory
// (Node, workers, tests). Apps can plug their own store, for example an
// encrypted one or React Native AsyncStorage behind a sync cache.

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

function browserStore(): KeyValueStore | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return null;
    const probe = "ghostpacket.probe";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null; // disabled (private mode, sandboxed iframe…)
  }
}

let base: KeyValueStore | null = null;
let custom: KeyValueStore | null = null;
let namespace = "";
let scoped: KeyValueStore | null = null;

function baseStore(): KeyValueStore {
  base ??= browserStore() ?? new MemoryStore();
  return base;
}

/** App data (ledger, keyring, outbox, records): namespaced when the app set one, custom store included. */
export function kv(): KeyValueStore {
  if (!namespace) return custom ?? baseStore();
  if (!scoped) {
    const s = custom ?? baseStore();
    const p = `${namespace}:`;
    scoped = {
      getItem: (k) => s.getItem(p + k),
      setItem: (k, v) => s.setItem(p + k, v),
      removeItem: (k) => s.removeItem(p + k),
    };
  }
  return scoped;
}

/** Device preferences shared by every app of the origin (theme, sounds). */
export function prefs(): KeyValueStore {
  return custom ?? baseStore();
}

/** Replaces the default store. Call before the SDK reads anything. */
export function setStorage(s: KeyValueStore): void {
  custom = s;
  scoped = null;
}

/**
 * Isolates this app's data from the other GhostPacket apps of the same origin
 * (several apps on one GitHub Pages site share localStorage). Call once at start-up.
 */
export function setStorageNamespace(ns: string): void {
  if (ns && !/^[a-z][a-z0-9-]{0,23}$/.test(ns)) throw new Error(`invalid storage namespace ${ns}`);
  if (ns === namespace) return;
  namespace = ns;
  scoped = null;
}

export function storageNamespace(): string {
  return namespace;
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = kv().getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** False when the store is full or unavailable: callers that guard money or medicine must fail closed. */
export function writeJson(key: string, value: unknown): boolean {
  try {
    kv().setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
