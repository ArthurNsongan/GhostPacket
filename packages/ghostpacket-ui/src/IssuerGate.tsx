"use client";

// Shows why a verified document cannot be redeemed yet and, for an unknown
// issuer, lets the operator pin it after checking the fingerprint out of band.
import { trustKey } from "ghostpacket-sdk/keyring";
import type { Gate } from "ghostpacket-sdk/redemption-policy";
import type { VerifiedFrame } from "ghostpacket-sdk/types";

export default function IssuerGate({ gate, verified, label, onPinned }: { gate: Gate; verified: VerifiedFrame; label: string; onPinned: () => void }) {
  if (gate.ok) return null;
  return (
    <div className="rounded-lg border border-amber/50 bg-amber/10 p-3 text-[12px] text-amber" role="status">
      <p className="font-mono text-[11px] font-bold tracking-widest">NOT REDEEMABLE · {gate.reason}</p>
      <p className="mt-1 text-ink">{gate.message}</p>
      {gate.reason === "UNPINNED_ISSUER" && (
        <button
          type="button"
          onClick={() => {
            trustKey({ label: label.slice(0, 32), publicKeyHex: verified.issuerPubkeyHex, fingerprint: verified.fingerprint });
            onPinned();
          }}
          className="mt-2 rounded-md px-3 py-1.5 text-[12px] font-semibold text-amber ring-1 ring-amber/60 hover:bg-amber/15"
        >
          I checked {verified.fingerprint} with the issuer: pin it
        </button>
      )}
    </div>
  );
}
