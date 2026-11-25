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

let store: KeyValueStore | null = null;

export function kv(): KeyValueStore {
  store ??= browserStore() ?? new MemoryStore();
  return store;
}

/** Replaces the default store. Call before the SDK reads anything. */
export function setStorage(s: KeyValueStore): void {
  store = s;
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = kv().getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    kv().setItem(key, JSON.stringify(value));
  } catch {
    /* store full or unavailable: data lasts for this session only */
  }
}
