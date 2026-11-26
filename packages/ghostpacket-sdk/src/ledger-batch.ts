// Round ledgers (LedgerBatchDelta, doc type 0x06): a whole savings-group round
// in one signed frame, broadcast to every member phone at once.
import type { DocumentBody, DocumentDraft, EncodedFrame, LedgerBatchEntry } from "./types";
import type { Core, Result } from "./wasm-bridge";

/** Smallest frame that holds the draft: GPKT v1 (≤ 512 B) when it fits, else v2. */
export function sealCompact(core: Core, draft: DocumentDraft, seed: Uint8Array, flags: number, passphrase?: string): Result<EncodedFrame> {
  const v1 = core.encode(draft, seed, flags, passphrase);
  if (v1.ok || (v1.error.code !== "PAYLOAD_TOO_LARGE" && v1.error.code !== "DECOMPRESSED_TOO_LARGE")) return v1;
  return core.encodeV2(draft, seed, flags, passphrase);
}

export type LedgerBody = Extract<DocumentBody, { ledgerBatchDelta: unknown }>["ledgerBatchDelta"];

/** Sum of the contributions (saturates at Number.MAX_SAFE_INTEGER). */
export function ledgerTotal(entries: LedgerBatchEntry[]): number {
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    entries.reduce((s, e) => s + e.amountMinor, 0),
  );
}

export function receiptIdText(e: LedgerBatchEntry): string {
  return String.fromCharCode(...e.receiptId).trim();
}
