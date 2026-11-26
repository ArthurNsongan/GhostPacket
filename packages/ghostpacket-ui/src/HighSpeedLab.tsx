"use client";

// V3 high-speed lab: sign an image into a GPKT v2 frame and push it through
// ChromaCrypt (color matrices, screen → camera) or the OFDM chord (speaker →
// microphone). "virtual" runs both channels in software with loss / noise;
// "field" uses the real speaker, screen, microphone and camera.
import { useRef, useState } from "react";

import { runAcousticLoopback } from "ghostpacket-sdk/audio-engine";
import { emitLevel, spectral } from "ghostpacket-sdk/effects";
import type { ImageBudget } from "ghostpacket-sdk/image-codec";
import type { Channel, EncodedFrame, VerifiedFrame } from "ghostpacket-sdk/types";
import type { Result } from "ghostpacket-sdk/wasm-bridge";

import { AirReceiver, AirSender, VirtualHandover } from "./AirTransfer";
import { Panel } from "./FormKit";
import type { GhostState } from "./GhostContext";
import ImageAttach, { type ImageSource } from "./ImageAttach";
import ResultCard from "./ResultCard";
import SpectralImageReveal from "./SpectralImageReveal";
import SpectrogramCanvas, { type SignalSink } from "./SpectrogramCanvas";

type Transport = "chroma" | "ofdm";

export default function HighSpeedLab({ ghost, variant }: { ghost: GhostState; variant: "virtual" | "field" }) {
  const { core, sdk } = ghost;
  const [src, setSrc] = useState<{ source: ImageSource; budget: ImageBudget } | null>(null);
  const [sealed, setSealed] = useState<EncodedFrame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<Transport>("chroma");
  const [loss, setLoss] = useState(30);
  const [snr, setSnr] = useState(15);
  const [reveal, setReveal] = useState<boolean[]>([]);
  const [verdict, setVerdict] = useState<{ v: Result<VerifiedFrame>; channel: Channel; seq: number } | null>(null);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const spectro = useRef<SignalSink>(null);
  const seq = useRef(0);

  const seal = async () => {
    if (!src) return;
    setError(null);
    setVerdict(null);
    const res = await sdk.sealImage(src.source, { title: "Field photo", subjectRef: "demo", caption: "Sent through the V3 high-speed lab" }, { budget: src.budget });
    if (!res.ok) return setError(`${res.error.code}: ${res.error.message}`);
    setSealed(res.value);
  };

  const deliver = (frame: Uint8Array, channel: Channel) => {
    setVerdict({ v: core.verify(frame, []), channel, seq: ++seq.current });
  };

  const runOfdm = async () => {
    if (!sealed) return;
    setRunning(true);
    setVerdict(null);
    spectral("transmit");
    const t0 = performance.now();
    try {
      const out = await runAcousticLoopback(core, sealed.frame, {
        mode: "ofdm",
        snrDb: snr,
        seed: core.crc32(sealed.frame) >>> 0,
        playAudio: false,
        onTick: (t) => {
          spectro.current?.push(t.window, t.sampleRate);
          emitLevel(t.window);
        },
      });
      const secs = (performance.now() - t0) / 1000;
      if (out.result.ok) {
        setStatus(`OFDM · ${sealed.frameLen} B in ${secs.toFixed(1)} s (${((sealed.frameLen * 8) / secs / 1000).toFixed(2)} kbit/s) at ${snr} dB SNR · ${out.result.value.correctedBytes} byte(s) fixed by Reed-Solomon`);
        deliver(out.result.value.frame, "ofdm");
      } else {
        setStatus(`${out.result.error.code}: ${out.result.error.message}`);
      }
    } finally {
      setRunning(false);
    }
  };

  const ofdmOk = !!sealed && sealed.frameLen <= core.limits.ofdmMaxFrame;
  return (
    <Panel title={variant === "virtual" ? "V3 high-speed lab · images over light and sound" : "V3 high-speed transfer · image, PC ↔ phone"}>
      <p className="text-[13px] text-mist">
        A photo is re-encoded on this device, signed into a GPKT v2 frame (up to 128 KB) and sent as <span className="text-ion">ChromaCrypt</span> color matrices (44×44 cells, 8 calibrated colors, Reed-Solomon, wide
        fountain) or as an <span className="text-phosphor">OFDM chord</span> (32 subcarriers, differential QPSK, ≈ 4 kbit/s). Everything is decoded by the Rust core.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <ImageAttach onChange={(source, budget) => setSrc(source ? { source, budget } : null)} disabled={running} />
          <button type="button" onClick={() => void seal()} disabled={!src || running} className="btn-accent self-start px-5 py-2 text-sm">
            Sign the image (GPKT v2)
          </button>
          {error && <p className="font-mono text-xs text-alarm">{error}</p>}
          {sealed && (
            <p className="font-mono text-xs text-ink">
              {(sealed.frameLen / 1024).toFixed(1)} KB · GPKT v{sealed.version} · {sealed.fingerprint} · ChromaCrypt ≈ {Math.ceil(sealed.frameLen / 505)} matrices · OFDM{" "}
              {ofdmOk ? `${core.ofdmBurstSeconds(sealed.frameLen).toFixed(1)} s` : "too large (≤ 16 KB)"}
            </p>
          )}
          {sealed && variant === "virtual" && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-1 rounded-lg bg-ink/[0.04] p-1">
                {(["chroma", "ofdm"] as Transport[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTransport(t)}
                    disabled={running || (t === "ofdm" && !ofdmOk)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-[13px] disabled:opacity-40 ${transport === t ? "bg-ink/[0.08] font-medium text-ink" : "text-mist"}`}
                  >
                    {t === "chroma" ? "ChromaCrypt (light)" : "OFDM chord (sound)"}
                  </button>
                ))}
              </div>
              {transport === "chroma" ? (
                <>
                  <label className="text-[12px] text-mist">
                    Matrices lost: <span className="font-mono text-alarm">{loss} %</span>
                    <input type="range" min={0} max={50} value={loss} onChange={(e) => setLoss(Number(e.target.value))} className="w-full" />
                  </label>
                  <VirtualHandover ghost={ghost} frame={sealed.frame} transport="chroma" dropPct={loss} onPartial={setReveal} onFrame={deliver} label="Send through ChromaCrypt (virtual camera)" />
                </>
              ) : (
                <>
                  <label className="text-[12px] text-mist">
                    White noise: <span className="font-mono text-phosphor">{snr} dB SNR</span>
                    <input type="range" min={8} max={30} value={snr} onChange={(e) => setSnr(Number(e.target.value))} className="w-full" />
                  </label>
                  <button type="button" onClick={() => void runOfdm()} disabled={running} className="cta-ember px-5 py-3 text-sm font-semibold disabled:opacity-50">
                    {running ? "Singing…" : "▶ Send through the OFDM chord (virtual air)"}
                  </button>
                  <SpectrogramCanvas core={core} ref={spectro} syncLocked={running} caption="OFDM · 1.5–7.4 kHz" />
                </>
              )}
              {status && transport === "ofdm" && <p className="font-mono text-xs text-mute">{status}</p>}
            </div>
          )}
          {sealed && variant === "field" && <AirSender ghost={ghost} frame={sealed.frame} mode="robust" caption="GhostPacket image" />}
        </div>
        <div className="flex flex-col gap-3">
          {variant === "field" && <AirReceiver ghost={ghost} mode="robust" onFrame={deliver} onPartial={setReveal} />}
          {reveal.length > 0 && !verdict && <SpectralImageReveal decoded={reveal} />}
          <ResultCard key={verdict?.seq ?? 0} verification={verdict?.v ?? null} channel={verdict ? (verdict.channel === "ofdm" ? "OFDM" : "ChromaCrypt") : "ChromaCrypt or OFDM"} />
        </div>
      </div>
    </Panel>
  );
}
