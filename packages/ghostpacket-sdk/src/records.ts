// Local-first records for apps built on the skeleton (patients, members,
// rounds, issued documents…). Synchronous, bounded collections on the SDK
// key-value store, so they work offline, in Node tests and behind a custom
// store. Each app isolates its data with setStorageNamespace().
import { readJson, writeJson } from "./storage";

export interface RecordBase {
  id: string;
  /** ms since epoch, set on first put. */
  createdAt: number;
  updatedAt: number;
}

export interface Collection<T extends RecordBase> {
  readonly name: string;
  list(): T[];
  get(id: string): T | undefined;
  /** Inserts or replaces by id. Returns false when the collection is full. */
  put(record: Omit<T, "createdAt" | "updatedAt"> & Partial<Pick<T, "createdAt">>): boolean;
  /**
   * Inserts a new record whose id comes from `makeId` (e.g. shortId). Draws a new
   * id on collision instead of overwriting; returns the stored record, or null
   * when the collection is full or no free id was found.
   */
  insert(makeId: () => string, build: (id: string) => Omit<T, "createdAt" | "updatedAt">): T | null;
  update(id: string, patch: Partial<Omit<T, "id" | "createdAt">>): T | undefined;
  remove(id: string): void;
  clear(): void;
  onChange(fn: () => void): () => void;
}

const listeners = new Map<string, Set<() => void>>();

/** A named collection, newest first, capped at `max` records (default 500). */
export function collection<T extends RecordBase>(name: string, max = 500): Collection<T> {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) throw new Error(`invalid collection name ${name}`);
  const key = `ghostpacket.records.v1.${name}`;
  const subs = listeners.get(name) ?? new Set<() => void>();
  listeners.set(name, subs);

  const list = (): T[] => {
    const raw = readJson<unknown>(key, []);
    return Array.isArray(raw) ? (raw as T[]).slice(0, max) : [];
  };
  const save = (items: T[]) => {
    writeJson(key, items.slice(0, max));
    subs.forEach((l) => l());
  };

  return {
    name,
    list,
    get: (id) => list().find((r) => r.id === id),
    put(record) {
      const items = list();
      const now = Date.now();
      const old = items.find((r) => r.id === record.id);
      if (!old && items.length >= max) return false;
      const next = { ...record, createdAt: old?.createdAt ?? record.createdAt ?? now, updatedAt: now } as T;
      save([next, ...items.filter((r) => r.id !== record.id)]);
      return true;
    },
    insert(makeId, build) {
      const items = list();
      if (items.length >= max) return null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const id = makeId();
        if (items.some((r) => r.id === id)) continue;
        const now = Date.now();
        const next = { ...build(id), id, createdAt: now, updatedAt: now } as T;
        save([next, ...items]);
        return list().some((r) => r.id === id) ? next : null;
      }
      return null;
    },
    update(id, patch) {
      const items = list();
      const old = items.find((r) => r.id === id);
      if (!old) return undefined;
      const next = { ...old, ...patch, id, createdAt: old.createdAt, updatedAt: Date.now() } as T;
      save(items.map((r) => (r.id === id ? next : r)));
      return next;
    },
    remove: (id) => save(list().filter((r) => r.id !== id)),
    clear: () => save([]),
    onChange(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Short readable id with a prefix, e.g. `PAT-7K2Q` (crypto random, no ambiguous characters). */
export function shortId(prefix: string, len = 4): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const rnd = new Uint8Array(len);
  crypto.getRandomValues(rnd);
  return `${prefix}-${Array.from(rnd, (b) => alphabet[b % alphabet.length]).join("")}`;
}

/** Draws ids until one is free (up to 8 tries); null if none was found. */
export function freeId(make: () => string, taken: (id: string) => boolean): string | null {
  for (let i = 0; i < 8; i++) {
    const id = make();
    if (!taken(id)) return id;
  }
  return null;
}

/** 8-byte GPKT document id from text (padded with spaces, ASCII only). */
export function docIdBytes(id: string): number[] {
  return Array.from(id.slice(0, 8).padEnd(8, " "), (c) => c.charCodeAt(0) & 0x7f);
}
