"use client";

// Ultrasonic Whisper: a near-silent key exchange. The issuer's device whispers
// a signed identity card at 17.6–19.6 kHz (400 bit/s, ≈ 4 s); the receiver
// verifies the signature in the core, shows the fingerprint to compare aloud,
// and pins the key. Same ceremony as the identity QR, without line of sight.
import { useMemo, useState } from "react";

import { trustKey, readKeyring } from "ghostpacket-sdk/keyring";
import { identityCardDraft, identityCardLabel } from "ghostpacket-sdk/messages";
import { FLAG_FSK, type Channel, type VerifiedFrame } from "ghostpacket-sdk/types";

import { AirReceiver, AirSender, VirtualBroadcast } from "./AirTransfer";
import type { GhostState } from "./GhostContext";

export default function WhisperIdentity({ ghost, label: initial = "GhostPacket issuer", variant }: { ghost: GhostState; label?: string; variant: "virtual" | "field" }) {
  const { core, seed, keyInfo } = ghost;
  const [label, setLabel] = useState(initial.slice(0, 32));
  const [heard, setHeard] = useState<{ v: VerifiedFrame; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState(0);

  const card = useMemo(() => {
    const enc = core.encode(identityCardDraft(label), seed, FLAG_FSK);
    return enc.ok ? enc.value : null;
  }, [core, seed, label]);

  const receive = (frame: Uint8Array, _channel: Channel) => {
    setError(null);
    const v = core.verify(frame, []);
    if (!v.ok) return setError(`${v.error.code}: ${v.error.message}`);
    const who = identityCardLabel(v.value.document.body);
    if (who === null) return setError("Verified, but this frame is not an identity card");
    setHeard({ v: v.value, label: who });
  };

  const known = heard ? readKeyring().some((k) => k.publicKeyHex.toUpperCase() === heard.v.issuerPubkeyHex.toUpperCase()) : false;
  void pinned;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-mist">
        A signed identity card ({card?.frameLen ?? "…"} B) whispered at 17.6–19.6 kHz, 400 bit/s: most adults hear almost nothing. Needs a 44.1 or 48 kHz sound path; phone speakers vary above 18 kHz, so this channel is
        best-effort.
      </p>
      <label className="block text-[12px] text-mist">
        Label on the card
        <input
          value={label}
          maxLength={32}
          onChange={(e) => setLabel(e.target.value)}
          className="mt-1 w-full rounded-md bg-ink/[0.045] px-2 py-1 text-sm text-ink outline-none focus:bg-ink/[0.08]"
          aria-label="Identity card label"
        />
      </label>
      <p className="text-[11px] text-mute">
        This device&apos;s key (sent): <span className="font-mono text-ion">{keyInfo.fingerprint}</span>
      </p>
      {variant === "virtual" ? (
        <VirtualBroadcast ghost={ghost} frame={card?.frame ?? null} mode="ultrasonic" snrDb={12} onFrame={receive} label="Whisper the identity card (virtual air)" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <AirSender ghost={ghost} frame={card?.frame ?? null} mode="ultrasonic" caption="Identity card" />
          <AirReceiver ghost={ghost} mode="ultrasonic" onFrame={receive} />
        </div>
      )}
      {error && <p className="rounded-lg bg-alarm/10 p-2 font-mono text-[11px] text-alarm">{error}</p>}
      {heard && (
        <div className="rounded-lg bg-phosphor/10 p-3 text-[12px]" role="status">
          <p className="font-mono text-[11px] font-bold tracking-widest text-phosphor">IDENTITY CARD · ED25519 VERIFIED</p>
          <p className="mt-1 text-ink">
            Received from {heard.label || "an unnamed issuer"}: <span className="font-mono text-ion">{heard.v.fingerprint}</span>
          </p>
          <p className="mt-1 text-[11px] text-mist">Ask the sender to read their fingerprint aloud and compare it with this one before pinning.</p>
          {known ? (
            <p className="mt-2 font-mono text-[11px] text-phosphor">Pinned in this device&apos;s keyring.</p>
          ) : (
            <button
              type="button"
              onClick={() => {
                trustKey({ label: (heard.label || "Whispered issuer").slice(0, 32), publicKeyHex: heard.v.issuerPubkeyHex, fingerprint: heard.v.fingerprint });
                setPinned((n) => n + 1);
              }}
              className="mt-2 rounded-md bg-phosphor/15 px-3 py-1.5 text-[12px] font-semibold text-phosphor hover:bg-phosphor/25"
            >
              The fingerprints match: pin this key
            </button>
          )}
        </div>
      )}
    </div>
  );
}
