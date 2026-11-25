// "The Crypt Ledger": local anti-replay record of verified documents.
// A document is identified by (issuer fingerprint, docId, signed timestamp).
// Seeing it again means the same receipt or voucher is being presented twice
// (offline double-spend). Stored in the key-value store (localStorage by default): ids, fingerprints, times and
// the document type only, never message text or decrypted content.
import { readJson, writeJson } from "./storage";
import { toHex } from "./wasm-bridge";
import type { Channel, VerifiedFrame } from "./types";
import { docTitle } from "./messages";

/** "sim" and "field" are the portal's; apps may use their own scope names (letters, digits, dashes). */
export type LedgerScope = "sim" | "field" | (string & {});

export interface LedgerEntry {
  key: string;
  docId: string;
  fingerprint: string;
  title: string;
  docTimestamp: number;
  channel: Channel;
  firstSeen: number;
  timesSeen: number;
}

export type LedgerCheck = { status: "first"; entry: LedgerEntry } | { status: "replay"; entry: LedgerEntry };

const MAX_ENTRIES = 200;
/** Guarded scopes (medicine dispensed, vouchers paid) never evict: forgetting an entry would allow a second redemption. */
const MAX_GUARDED = 5000;
const guarded = new Set<string>();
const storageKey = (scope: LedgerScope) => `ghostpacket.ledger.v1.${scope}`;
const listeners = new Set<() => void>();
const cap = (scope: LedgerScope) => (guarded.has(scope) ? MAX_GUARDED : MAX_ENTRIES);

/** Marks a scope as guarded: no eviction, no clear, fail closed (see redeemOnce). */
export function guardScope(scope: LedgerScope): void {
  guarded.add(scope);
}

export function isGuarded(scope: LedgerScope): boolean {
  return guarded.has(scope);
}

export type RedeemOutcome = LedgerCheck | { status: "unavailable"; code: "LEDGER_FULL" | "LEDGER_WRITE_FAILED"; message: string };

function readDocId(bytes: number[]): string {
  const printable = bytes.every((b) => b >= 0x20 && b < 0x7f);
  return printable ? String.fromCharCode(...bytes).trim() : toHex(Uint8Array.from(bytes));
}

export function readLedger(scope: LedgerScope): LedgerEntry[] {
  const parsed = readJson<unknown>(storageKey(scope), []);
  return Array.isArray(parsed) ? (parsed as LedgerEntry[]).slice(0, cap(scope)) : [];
}

function write(scope: LedgerScope, entries: LedgerEntry[]): boolean {
  const ok = writeJson(storageKey(scope), entries.slice(0, cap(scope)));
  listeners.forEach((l) => l());
  return ok;
}

const keyOf = (v: VerifiedFrame) => `${v.fingerprint}/${readDocId(v.document.docId)}/${v.document.timestamp}`;

/**
 * Redemption for guarded scopes: records the document or reports a replay, and
 * refuses (fails closed) when the ledger is full or cannot be written, so a
 * storage problem can never turn into a second dispensing or payment.
 */
export function redeemOnce(scope: LedgerScope, v: VerifiedFrame, channel: Channel): RedeemOutcome {
  guardScope(scope);
  const entries = readLedger(scope);
  const key = keyOf(v);
  const existing = entries.find((e) => e.key === key);
  if (existing) {
    write(scope, [{ ...existing, timesSeen: existing.timesSeen + 1 }, ...entries.filter((e) => e.key !== key)]);
    return { status: "replay", entry: existing };
  }
  if (entries.length >= MAX_GUARDED) return { status: "unavailable", code: "LEDGER_FULL", message: `Redemption ledger full (${MAX_GUARDED}); sync and archive first` };
  const entry: LedgerEntry = { key, docId: readDocId(v.document.docId), fingerprint: v.fingerprint, title: storedTitle(v), docTimestamp: v.document.timestamp, channel, firstSeen: Date.now(), timesSeen: 1 };
  if (!write(scope, [entry, ...entries])) return { status: "unavailable", code: "LEDGER_WRITE_FAILED", message: "Storage full or unavailable: nothing was recorded, refuse for now" };
  // Read back: the record must really be on disk before the medicine or money leaves.
  if (!readLedger(scope).some((e) => e.key === key)) return { status: "unavailable", code: "LEDGER_WRITE_FAILED", message: "Redemption could not be confirmed on disk" };
  return { status: "first", entry };
}

/** Records a verified frame, or reports that it was already redeemed. */
/**
 * Label kept on disk. Free-form titles (and anything decrypted) are user
 * content: they never reach localStorage, only the document type does.
 */
function storedTitle(v: VerifiedFrame): string {
  if (v.encrypted) return "Encrypted document";
  return "customMessage" in v.document.body ? "Message" : docTitle(v.document.body);
}

export function redeem(scope: LedgerScope, v: VerifiedFrame, channel: Channel): LedgerCheck {
  const docId = readDocId(v.document.docId);
  // The signed timestamp is part of the identity: two different messages that
  // happen to draw the same short id are not mistaken for a replay, while the
  // same signed document presented again always matches.
  const key = `${v.fingerprint}/${docId}/${v.document.timestamp}`;
  const entries = readLedger(scope);
  const existing = entries.find((e) => e.key === key);
  if (existing) {
    const updated = { ...existing, timesSeen: existing.timesSeen + 1 };
    write(scope, [updated, ...entries.filter((e) => e.key !== key)]);
    return { status: "replay", entry: existing };
  }
  const entry: LedgerEntry = {
    key,
    docId,
    fingerprint: v.fingerprint,
    title: storedTitle(v),
    docTimestamp: v.document.timestamp,
    channel,
    firstSeen: Date.now(),
    timesSeen: 1,
  };
  write(scope, [entry, ...entries]);
  return { status: "first", entry };
}

/** Looks a document up without recording it (e.g. "already dispensed?" before the button is pressed). */
export function findRedemption(scope: LedgerScope, v: VerifiedFrame): LedgerEntry | null {
  const key = keyOf(v);
  return readLedger(scope).find((e) => e.key === key) ?? null;
}

/** Clears a demo ledger. Guarded scopes cannot be cleared from the UI. */
export function clearLedger(scope: LedgerScope): void {
  if (guarded.has(scope)) return;
  write(scope, []);
}

export function onLedgerChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
