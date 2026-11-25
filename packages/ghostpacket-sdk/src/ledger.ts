// "The Crypt Ledger": local anti-replay record of verified documents.
// A document is identified by (issuer fingerprint, docId, signed timestamp).
// Seeing it again means the same receipt or voucher is being presented twice
// (offline double-spend). Stored in the key-value store (localStorage by default): ids, fingerprints, times and
// the document type only, never message text or decrypted content.
import { readJson, writeJson } from "./storage";
import { toHex } from "./wasm-bridge";
import type { Channel, VerifiedFrame } from "./types";
import { docTitle } from "./messages";

export type LedgerScope = "sim" | "field";

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
const storageKey = (scope: LedgerScope) => `ghostpacket.ledger.v1.${scope}`;
const listeners = new Set<() => void>();

function readDocId(bytes: number[]): string {
  const printable = bytes.every((b) => b >= 0x20 && b < 0x7f);
  return printable ? String.fromCharCode(...bytes).trim() : toHex(Uint8Array.from(bytes));
}

export function readLedger(scope: LedgerScope): LedgerEntry[] {
  const parsed = readJson<unknown>(storageKey(scope), []);
  return Array.isArray(parsed) ? (parsed as LedgerEntry[]).slice(0, MAX_ENTRIES) : [];
}

function write(scope: LedgerScope, entries: LedgerEntry[]): void {
  writeJson(storageKey(scope), entries.slice(0, MAX_ENTRIES));
  listeners.forEach((l) => l());
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

export function clearLedger(scope: LedgerScope): void {
  write(scope, []);
}

export function onLedgerChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
