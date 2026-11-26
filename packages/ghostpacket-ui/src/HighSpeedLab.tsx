"use client";

// V3 high-speed lab: sign an image into a GPKT v2 frame (optionally end-to-end
// encrypted) and push it through ChromaCrypt (color matrices, screen → camera),
// the OFDM chord (speaker → microphone), Chimera Turbo (both at once, one
// decoder) or a WebRTC LAN link signaled over the air. "virtual" runs every
// channel in software with loss / noise; "field" uses real devices.
import { useState } from "react";

import type { ImageBudget } from "ghostpacket-sdk/image-codec";
import type { Channel, EncodedFrame, VerifiedFrame } from "ghostpacket-sdk/types";
import type { Result } from "ghostpacket-sdk/wasm-bridge";

import { AirReceiver, AirSender, VirtualBroadcast, VirtualHandover } from "./AirTransfer";
import ChimeraTurboLab from "./ChimeraTurboLab";
import { Panel } from "./FormKit";
import type { GhostState } from "./GhostContext";
import ImageAttach, { type ImageSource } from "./ImageAttach";
import LanLinkPanel from "./LanLinkPanel";
import { EncryptionToggle, encryptionBlocked, type EncryptionSetting } from "./MessageComposer";
import ResultCard from "./ResultCard";
import SpectralImageReveal from "./SpectralImageReveal";

type Transport = "chroma" | "ofdm" | "chimera" | "lan";

const TRANSPORTS: { id: Transport; label: string }[] = [
  { id: "chroma", label: "ChromaCrypt (light)" },
  { id: "ofdm", label: "OFDM chord (sound)" },
  { id: "chimera", label: "Chimera Turbo (both)" },
  { id: "lan", label: "WebRTC LAN" },
];

const CHANNEL_LABEL: Partial<Record<Channel, string>> = { ofdm: "OFDM", chroma: "ChromaCrypt", chimera: "Chimera Turbo", lan: "WebRTC LAN" };
const LOCKED = new Set(["PASSPHRASE_REQUIRED", "DECRYPTION_FAILED"]);

export default function HighSpeedLab({ ghost, variant }: { ghost: GhostState; variant: "virtual" | "field" }) {
  const { core, sdk } = ghost;
  const [src, setSrc] = useState<{ source: ImageSource; budget: ImageBudget } | null>(null);
  const [sealed, setSealed] = useState<EncodedFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<Transport>("chroma");
  const [loss, setLoss] = useState(30);
  const [snr, setSnr] = useState(15);
  const [encryption, setEncryption] = useState<EncryptionSetting>({ on: false, passphrase: "" });
  const [rxPass, setRxPass] = useState("");
  const [reveal, setReveal] = useState<boolean[]>([]);
  const [verdict, setVerdict] = useState<{ v: Result<VerifiedFrame>; channel: Channel; frame: Uint8Array; seq: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [seq, setSeq] = useState(0);

  const seal = async () => {
    if (!src || encryptionBlocked(encryption)) return;
    setError(null);
    setVerdict(null);
    setBusy(true);
    const res = await sdk.sealImage(
      src.source,
      { title: "Field photo", subjectRef: "demo", caption: "Sent through the V3 high-speed lab" },
      { budget: src.budget, passphrase: encryption.on ? encryption.passphrase : undefined },
    );
    setBusy(false);
    if (!res.ok) return setError(`${res.error.code}: ${res.error.message}`);
    setSealed(res.value);
  };

  const verify = (frame: Uint8Array, channel: Channel, phrase = rxPass) => {
    const n = seq + 1;
    setSeq(n);
    setVerdict({ v: core.verify(frame, [], phrase.trim() ? phrase : undefined), channel, frame, seq: n });
  };
  const deliver = (frame: Uint8Array, channel: Channel) => verify(frame, channel);
  const locked = verdict && !verdict.v.ok && LOCKED.has(verdict.v.error.code);

  const ofdmOk = !!sealed && sealed.frameLen <= core.limits.ofdmMaxFrame;
  const frame = sealed?.frame ?? null;
  return (
    <Panel title={variant === "virtual" ? "V3 high-speed lab · images over light and sound" : "V3 high-speed transfer · image, PC ↔ phone"}>
      <p className="text-[13px] text-mist">
        A photo is re-encoded on this device, signed into a GPKT v2 frame (up to 128 KB), optionally sealed with ChaCha20-Poly1305, and sent as <span className="text-ion">ChromaCrypt</span> color matrices (44×44 cells, 8
        calibrated colors, Reed-Solomon, wide fountain), as an <span className="text-phosphor">OFDM chord</span> (32 subcarriers, differential QPSK, ≈ 4 kbit/s), through both at once (Chimera Turbo), or over a local WebRTC link.
        Everything is decoded and verified by the Rust core.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <ImageAttach onChange={(source, budget) => setSrc(source ? { source, budget } : null)} disabled={busy} />
          <EncryptionToggle value={encryption} onChange={setEncryption} limits={core.limits} disabled={busy} />
          <button type="button" onClick={() => void seal()} disabled={!src || busy || encryptionBlocked(encryption)} className="btn-accent self-start px-5 py-2 text-sm">
            {encryption.on ? "Sign and encrypt the image (GPKT v2)" : "Sign the image (GPKT v2)"}
          </button>
          {error && <p className="font-mono text-xs text-alarm">{error}</p>}
          {sealed && (
            <p className="font-mono text-xs text-ink">
              {(sealed.frameLen / 1024).toFixed(1)} KB · GPKT v{sealed.version}
              {sealed.encrypted ? " · E2EE" : ""} · {sealed.fingerprint} · ChromaCrypt ≈ {Math.ceil(sealed.frameLen / 505)} matrices · OFDM {ofdmOk ? `${core.ofdmBurstSeconds(sealed.frameLen).toFixed(1)} s` : "too large (≤ 16 KB)"}
            </p>
          )}
          {sealed && variant === "virtual" && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-ink/[0.04] p-1 sm:grid-cols-4">
                {TRANSPORTS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTransport(t.id)}
                    disabled={t.id === "ofdm" && !ofdmOk}
                    className={`rounded-md px-2 py-1.5 text-[12px] disabled:opacity-40 ${transport === t.id ? "bg-ink/[0.08] font-medium text-ink" : "text-mist"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {(transport === "chroma" || transport === "chimera") && (
                <label className="text-[12px] text-mist">
                  Matrices lost: <span className="font-mono text-alarm">{loss} %</span>
                  <input type="range" min={0} max={50} value={loss} onChange={(e) => setLoss(Number(e.target.value))} className="w-full" />
                </label>
              )}
              {(transport === "ofdm" || transport === "chimera") && (
                <label className="text-[12px] text-mist">
                  White noise: <span className="font-mono text-phosphor">{snr} dB SNR</span>
                  <input type="range" min={8} max={30} value={snr} onChange={(e) => setSnr(Number(e.target.value))} className="w-full" />
                </label>
              )}
              {transport === "chroma" && <VirtualHandover ghost={ghost} frame={frame} transport="chroma" dropPct={loss} onPartial={setReveal} onFrame={deliver} label="Send through ChromaCrypt (virtual camera)" />}
              {transport === "ofdm" && <VirtualBroadcast ghost={ghost} frame={frame} mode="ofdm" snrDb={snr} onFrame={deliver} label="Send through the OFDM chord (virtual air)" />}
              {transport === "chimera" && <ChimeraTurboLab ghost={ghost} frame={frame} dropPct={loss} snrDb={snr} onPartial={setReveal} onFrame={deliver} />}
              {transport === "lan" && <LanLinkPanel ghost={ghost} frame={frame} onFrame={deliver} variant="virtual" />}
            </div>
          )}
          {sealed && variant === "field" && (
            <>
              <AirSender ghost={ghost} frame={frame} mode="robust" caption="GhostPacket image" />
              <h3 className="panel-title mt-2">WebRTC LAN link</h3>
              <LanLinkPanel ghost={ghost} frame={frame} onFrame={deliver} variant="field" />
            </>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {variant === "field" && <AirReceiver ghost={ghost} mode="robust" onFrame={deliver} onPartial={setReveal} />}
          {variant === "field" && !sealed && (
            <>
              <h3 className="panel-title mt-2">WebRTC LAN link</h3>
              <LanLinkPanel ghost={ghost} frame={null} onFrame={deliver} variant="field" />
            </>
          )}
          {reveal.length > 0 && !verdict && <SpectralImageReveal decoded={reveal} />}
          <ResultCard
            key={verdict?.seq ?? 0}
            verification={verdict?.v ?? null}
            channel={verdict ? (CHANNEL_LABEL[verdict.channel] ?? verdict.channel) : "ChromaCrypt, OFDM, Chimera Turbo or LAN"}
          />
          {locked && verdict && (
            <div className="flex flex-col gap-2 rounded-lg bg-ion/10 p-3">
              <label className="text-[12px] text-mist">
                Receiver passphrase (shared out of band)
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={rxPass}
                  onChange={(e) => setRxPass(e.target.value)}
                  aria-label="Receiver passphrase"
                  className="mt-1 w-full rounded-md bg-ink/[0.045] px-2 py-1.5 font-mono text-sm text-ink outline-none focus:bg-ink/[0.08]"
                />
              </label>
              <button type="button" onClick={() => verify(verdict.frame, verdict.channel)} disabled={!rxPass.trim()} className="self-start rounded-md bg-ion/15 px-3 py-1.5 text-[12px] font-semibold text-ion hover:bg-ion/25 disabled:opacity-40">
                Decrypt and verify
              </button>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
