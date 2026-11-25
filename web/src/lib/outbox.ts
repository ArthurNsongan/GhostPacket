// Proof outbox: offline-to-cloud sync of verified frames.
//
// A field device verifies a frame offline, queues it here, and uploads it to a
// `ghostpacket-verifier` (crates/ghostpacket-verifier) when connectivity
// returns. The server re-verifies with the same Rust code and keeps its own
// anti-replay ledger, so a voucher redeemed on two offline devices is caught
// at sync time (HTTP 409).
//
// Network policy: nothing is ever sent unless the app or the user configures
// an endpoint. Frames are stored exactly as received (ciphertext for E2EE
// frames); they never leave the device otherwise.
import { readJson, writeJson, kv } from "./storage";
import type { Channel, VerifiedFrame } from "./types";

export type OutboxState = "pending" | "synced" | "replay" | "rejected";

export interface OutboxItem {
  id: string;
  frameB64: string;
  fingerprint: string;
  docId: string;
  docTimestamp: number;
  encrypted: boolean;
  channel: Channel;
  queuedAt: number;
  state: OutboxState;
  attempts: number;
  syncedAt?: number;
  /** Server error code for rejected items, first redemption time for replays. */
  serverCode?: string;
  serverFirstSeen?: number;
}

export interface SyncReport {
  sent: number;
  synced: number;
  replays: number;
  rejected: number;
  /** Set when the endpoint could not be reached: remaining items stay pending. */
  networkError?: string;
}

export interface SyncOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Bearer token for a verifier started with GHOSTPACKET_TOKEN. */
  token?: string;
}

const KEY = "ghostpacket.outbox.v1";
const ENDPOINT_KEY = "ghostpacket.sync.endpoint";
export const MAX_OUTBOX = 200;
const listeners = new Set<() => void>();

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function frameOf(item: OutboxItem): Uint8Array {
  const s = atob(item.frameB64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Same rule as the verifier: printable ASCII ids as text, anything else as hex (no collisions on "?"). */
function docIdText(bytes: number[]): string {
  const printable = bytes.length > 0 && bytes[0] !== 0x20 && bytes.every((b) => b >= 0x20 && b < 0x7f);
  return printable ? String.fromCharCode(...bytes).trimEnd() : bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Server fields are untrusted: keep only well-formed codes and plausible timestamps. */
function serverCode(v: unknown, status: number): string {
  return typeof v === "string" && /^[A-Z0-9_]{1,40}$/.test(v) ? v : `HTTP_${status}`;
}

function serverTime(v: unknown): number | undefined {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
}

/** Eviction order when the outbox is full; pending items are never evicted. */
const EVICTABLE: OutboxState[] = ["rejected", "replay", "synced"];

let inflight: Promise<SyncReport> | null = null;

/** One sync at a time, across tabs when the Web Locks API exists. */
async function singleFlight(run: () => Promise<SyncReport>): Promise<SyncReport> {
  if (inflight) return inflight;
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  const p: Promise<SyncReport> = locks ? (async () => await locks.request("ghostpacket-outbox-sync", run))() : run();
  inflight = p.finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Accepts `https://…`, or plain `http://` only for this machine
 * (localhost, 127.0.0.1, [::1]) so a local verifier can be used in the field.
 * A base URL gets `/v1/proofs` appended.
 */
export function normalizeEndpoint(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
    return { ok: false, reason: "Use https:// (plain http only for localhost)" };
  }
  if (u.username || u.password) return { ok: false, reason: "Credentials in the URL are not allowed" };
  if (!u.pathname.endsWith("/v1/proofs")) u.pathname = `${u.pathname.replace(/\/$/, "")}/v1/proofs`;
  u.hash = "";
  return { ok: true, url: u.toString() };
}

export class ProofOutbox {
  list(): OutboxItem[] {
    const items = readJson<unknown>(KEY, []);
    return Array.isArray(items) ? (items as OutboxItem[]).slice(0, MAX_OUTBOX) : [];
  }

  private save(items: OutboxItem[]): void {
    writeJson(KEY, items.slice(0, MAX_OUTBOX));
    listeners.forEach((l) => l());
  }

  pending(): OutboxItem[] {
    return this.list().filter((i) => i.state === "pending");
  }

  /**
   * Queues a verified frame; the same document (issuer, id, timestamp) is queued once.
   * Returns null when the outbox holds MAX_OUTBOX pending items (sync first).
   */
  enqueue(frame: Uint8Array, v: VerifiedFrame, channel: Channel): OutboxItem | null {
    const docId = docIdText(v.document.docId);
    const id = `${v.fingerprint}/${docId}/${v.document.timestamp}`;
    const items = this.list();
    const existing = items.find((i) => i.id === id);
    if (existing) return existing;
    const item: OutboxItem = {
      id,
      frameB64: b64(frame),
      fingerprint: v.fingerprint,
      docId,
      docTimestamp: v.document.timestamp,
      encrypted: v.encrypted,
      channel,
      queuedAt: Date.now(),
      state: "pending",
      attempts: 0,
    };
    // Oldest settled items make room (rejected, then replays, then synced); pending ones are never dropped.
    const next = [item, ...items];
    while (next.length > MAX_OUTBOX) {
      const states = next.map((i) => i.state);
      const idx = EVICTABLE.map((s) => states.lastIndexOf(s)).find((i) => i >= 0);
      if (idx === undefined) return null;
      next.splice(idx, 1);
    }
    this.save(next);
    return item;
  }

  remove(id: string): void {
    this.save(this.list().filter((i) => i.id !== id));
  }

  clear(): void {
    this.save([]);
  }

  /**
   * Uploads pending items one by one. Stops at the first network failure.
   * Only one sync runs at a time (concurrent calls share the running one).
   */
  sync(endpoint: string, opts: SyncOptions = {}): Promise<SyncReport> {
    const norm = normalizeEndpoint(endpoint);
    if (!norm.ok) return Promise.resolve({ sent: 0, synced: 0, replays: 0, rejected: 0, networkError: norm.reason });
    return singleFlight(() => this.run(norm.url, opts));
  }

  private async run(url: string, opts: SyncOptions): Promise<SyncReport> {
    const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const report: SyncReport = { sent: 0, synced: 0, replays: 0, rejected: 0 };
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    for (const item of this.pending()) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
      let status: number;
      let body: { code?: unknown; first_received_at?: unknown } = {};
      try {
        const r = await doFetch(url, {
          method: "POST",
          headers,
          body: frameOf(item) as BodyInit,
          signal: ctrl.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          // A redirect could forward the proof to another host.
          redirect: "error",
        });
        status = r.status;
        const parsed: unknown = await r.json().catch(() => ({}));
        if (parsed && typeof parsed === "object") body = parsed as typeof body;
      } catch (e) {
        this.update(item.id, { attempts: item.attempts + 1 });
        report.networkError = e instanceof Error ? e.message : String(e);
        clearTimeout(timer);
        break;
      }
      clearTimeout(timer);
      report.sent++;
      const now = Date.now();
      if (status === 201) {
        report.synced++;
        this.update(item.id, { state: "synced", syncedAt: now, attempts: item.attempts + 1 });
      } else if (status === 409) {
        // Already redeemed on the server, e.g. from another offline device: double spend.
        report.replays++;
        this.update(item.id, { state: "replay", syncedAt: now, attempts: item.attempts + 1, serverFirstSeen: serverTime(body.first_received_at) });
      } else if (status === 422 || status === 413) {
        report.rejected++;
        this.update(item.id, { state: "rejected", syncedAt: now, attempts: item.attempts + 1, serverCode: serverCode(body.code, status) });
      } else {
        // 5xx, 429…: keep pending and retry later.
        this.update(item.id, { attempts: item.attempts + 1, serverCode: serverCode(body.code, status) });
        report.networkError = `HTTP ${status}`;
        break;
      }
    }
    return report;
  }

  private update(id: string, patch: Partial<OutboxItem>): void {
    this.save(this.list().map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
}

export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function savedEndpoint(): string {
  try {
    return kv().getItem(ENDPOINT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveEndpoint(url: string): void {
  try {
    if (url) kv().setItem(ENDPOINT_KEY, url);
    else kv().removeItem(ENDPOINT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Syncs whenever the browser comes back online. Returns a stop function.
 * Does nothing (and sends nothing) while `endpoint()` is empty.
 */
export function autoSync(outbox: ProofOutbox, endpoint: () => string, onReport?: (r: SyncReport) => void, opts?: SyncOptions): () => void {
  if (typeof window === "undefined") return () => undefined;
  const run = async () => {
    const url = endpoint();
    if (!url || !navigator.onLine || outbox.pending().length === 0) return;
    onReport?.(await outbox.sync(url, opts));
  };
  window.addEventListener("online", run);
  void run();
  return () => window.removeEventListener("online", run);
}
