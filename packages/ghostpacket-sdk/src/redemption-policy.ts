// Who may make a verified document "spend" (medicine dispensed, money paid).
// A valid Ed25519 signature only proves *someone* signed it: anyone can open the
// public app and sign a voucher with a fresh key. Redemption therefore also
// requires a pinned issuer (keyring), the expected document type, a real
// (non-DEMO) frame and plausible timestamps.
import { readKeyring } from "./keyring";
import { FLAG_DEMO, type DocumentBody, type VerifiedFrame } from "./types";

export type DocKind = "medicalPrescription" | "emergencyVoucher" | "tontineReceipt" | "customMessage" | "imageDocument" | "ledgerBatchDelta";

export type GateReason = "WRONG_DOCUMENT" | "DEMO_FRAME" | "UNPINNED_ISSUER" | "FUTURE_TIMESTAMP" | "EXPIRED";

export type Gate = { ok: true } | { ok: false; reason: GateReason; message: string };

/** Signed timestamps more than 10 minutes ahead of this device's clock are refused. */
const MAX_CLOCK_SKEW_S = 600;

export function kindOf(body: DocumentBody): DocKind {
  return Object.keys(body)[0] as DocKind;
}

export function issuerPinned(v: VerifiedFrame, selfKeyHex?: string): boolean {
  const hex = v.issuerPubkeyHex.toUpperCase();
  if (selfKeyHex && selfKeyHex.toUpperCase() === hex) return true;
  return readKeyring().some((k) => k.publicKeyHex.toUpperCase() === hex);
}

export function redemptionGate(v: VerifiedFrame, opts: { kind: DocKind; selfKeyHex?: string; nowSec?: number }): Gate {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const body = v.document.body;
  if (kindOf(body) !== opts.kind) return { ok: false, reason: "WRONG_DOCUMENT", message: `This is a ${kindOf(body)}, not a ${opts.kind}` };
  if (v.flags & FLAG_DEMO) return { ok: false, reason: "DEMO_FRAME", message: "Demo frame (DEMO flag): never redeemable" };
  if (!issuerPinned(v, opts.selfKeyHex)) {
    return { ok: false, reason: "UNPINNED_ISSUER", message: `Issuer ${v.fingerprint} is not in this device's keyring: check the fingerprint with the issuer, then pin it` };
  }
  if (v.document.timestamp > now + MAX_CLOCK_SKEW_S) return { ok: false, reason: "FUTURE_TIMESTAMP", message: "Signed in the future: check both clocks" };
  if ("emergencyVoucher" in body && body.emergencyVoucher.validUntil < now) {
    return { ok: false, reason: "EXPIRED", message: `Voucher expired on ${new Date(body.emergencyVoucher.validUntil * 1000).toLocaleDateString()}` };
  }
  return { ok: true };
}
