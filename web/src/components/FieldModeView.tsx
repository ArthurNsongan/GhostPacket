"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { MicReceiver, playBurst, type MicStatus } from "@/lib/audio-engine";
import { DEMO_FLAGS } from "@/lib/demo-runner";
import { broadcast, CameraScanner } from "@/lib/optical-engine";
import { PRESETS, presetById, type Preset } from "@/lib/presets";
import type { FskMode, KeyInfo, VerifiedFrame } from "@/lib/types";
import type { Core, FountainReceiver, Result } from "@/lib/wasm-bridge";

import FountainGridCanvas, { EMPTY_FOUNTAIN, type FountainView } from "./FountainGridCanvas";
import ResultCard from "./ResultCard";
import SpectrogramCanvas, { type SignalSink } from "./SpectrogramCanvas";

function permissionProblem(e: unknown): string | null {
  if (e instanceof DOMException && ["NotAllowedError", "NotFoundError", "NotReadableError", "SecurityError", "OverconstrainedError"].includes(e.name)) {
    return e.name;
  }
  if (e instanceof TypeError) return "mediaDevices unavailable (HTTPS required)";
  return null;
}

/** Real PC ↔ phone mode: speaker/screen on one device, microphone/camera on the other (US-05). */
export default function FieldModeView({
  core,
  seed,
  keyInfo,
  onFallback,
}: {
  core: Core;
  seed: Uint8Array;
  keyInfo: KeyInfo;
  onFallback: (reason: string) => void;
}) {
  const [role, setRole] = useState<"emitter" | "receiver">("emitter");
  const [presetId, setPresetId] = useState<Preset["id"]>("tontine");
  const [mode, setMode] = useState<FskMode>("robust");
  const [status, setStatus] = useState<string>("ready");
  const [micStatus, setMicStatus] = useState<MicStatus | null>(null);
  const [fountain, setFountain] = useState<FountainView>(EMPTY_FOUNTAIN);
  const [verdict, setVerdict] = useState<{ channel: string; v: Result<VerifiedFrame> } | null>(null);
  const [fullscreenQr, setFullscreenQr] = useState(false);
  const [qrIndex, setQrIndex] = useState(0);
  const [active, setActive] = useState<"sound" | "qr" | "mic" | "camera" | null>(null);

  const spectro = useRef<SignalSink>(null);
  const qrCanvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const abort = useRef<AbortController | null>(null);
  const mic = useRef<MicReceiver | null>(null);
  const cam = useRef<CameraScanner | null>(null);
  const rx = useRef<FountainReceiver | null>(null);

  const encoded = useMemo(() => core.encode(presetById(presetId).draft, seed, DEMO_FLAGS), [core, presetId, seed]);
  const burstSeconds = encoded.ok ? core.fskBurstSeconds(encoded.value.frameLen, mode) : 0;

  const stopAll = () => {
    abort.current?.abort();
    abort.current = null;
    mic.current?.stop();
    mic.current = null;
    cam.current?.stop();
    cam.current = null;
    rx.current?.free();
    rx.current = null;
    setActive(null);
    setFullscreenQr(false);
  };

  useEffect(() => () => stopAll(), []);

  const emitSound = async () => {
    if (!encoded.ok) return;
    stopAll();
    setActive("sound");
    abort.current = new AbortController();
    setStatus(`sending sound, ${mode === "robust" ? "robust" : "fast"} · ${burstSeconds.toFixed(1)} s`);
    try {
      const res = await playBurst(core, encoded.value.frame, mode, {
        signal: abort.current.signal,
        onTick: (t) => spectro.current?.push(t.window, t.sampleRate),
      });
      setStatus(res.ok ? "burst sent" : `${res.error.code}: ${res.error.message}`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setStatus(String(e));
    } finally {
      setActive(null);
    }
  };

  const emitQr = () => {
    if (!encoded.ok) return;
    stopAll();
    setActive("qr");
    setFullscreenQr(true);
    abort.current = new AbortController();
    const signal = abort.current.signal;
    requestAnimationFrame(() => {
      if (!qrCanvas.current) return;
      broadcast(core, encoded.value.frame, qrCanvas.current, 8, signal, (i) => setQrIndex(i)).catch((e: unknown) => setStatus(String(e)));
    });
  };

  const listen = async () => {
    stopAll();
    setVerdict(null);
    setActive("mic");
    const receiver = new MicReceiver(core, mode, {
      onTick: (t) => spectro.current?.push(t.window, t.sampleRate),
      onStatus: (s, d) => {
        setMicStatus(s);
        if (d) setStatus(d);
      },
      onFrame: (frame, info) => {
        setVerdict({ channel: "microphone", v: core.verify(frame) });
        setStatus(`frame received · symbol SNR ${info.meanSymbolSnrDb.toFixed(1)} dB · ${info.correctedBytes} byte(s) fixed`);
      },
    });
    mic.current = receiver;
    try {
      await receiver.start();
      setStatus(`listening on the microphone (mode ${mode === "robust" ? "robust" : "fast"})`);
    } catch (e) {
      stopAll();
      const p = permissionProblem(e);
      if (p) onFallback(`Microphone unavailable (${p}): switched to the virtual loopback.`);
      else setStatus(String(e));
    }
  };

  const scan = async () => {
    stopAll();
    setVerdict(null);
    setFountain(EMPTY_FOUNTAIN);
    if (!video.current) return;
    setActive("camera");
    const receiver = core.fountainRx();
    rx.current = receiver;
    let shown = 0;
    const scanner = new CameraScanner(video.current, receiver, (step) => {
      shown++;
      if (!step.ok) {
        if (step.error.code === "DROPLET_SESSION_MISMATCH") {
          receiver.reset();
          setStatus("new session detected: decoder reset");
        }
        return;
      }
      const s = step.value;
      setFountain((v) => ({
        k: s.totalK,
        decoded: s.decoded,
        flash: s.newlyResolved,
        cascadeDepth: Math.max(v.cascadeDepth, s.cascadeDepth),
        byElimination: v.byElimination || s.solvedByElimination,
        shown,
        received: s.dropletsReceived,
        pending: s.pending,
        complete: s.complete,
      }));
      if (s.complete) {
        const frame = receiver.frame();
        setVerdict({ channel: "camera", v: frame.ok ? core.verify(frame.value) : frame });
        cam.current?.stop();
        cam.current = null;
        setActive(null);
      }
    });
    cam.current = scanner;
    try {
      await scanner.start();
      setStatus(`camera on · decoder ${scanner.engine}`);
    } catch (e) {
      stopAll();
      const p = permissionProblem(e);
      if (p) onFallback(`Camera unavailable (${p}): switched to the virtual loopback.`);
      else setStatus(String(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="panel flex flex-wrap items-center gap-3 p-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-void/60 p-1">
          {(["emitter", "receiver"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                stopAll();
                setRole(r);
              }}
              className={`rounded-md px-4 py-2 text-sm ${role === r ? "bg-phosphor/15 text-phosphor ring-1 ring-phosphor/40" : "text-mute"}`}
            >
              {r === "emitter" ? "This device sends" : "This device receives"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-mute">Modem</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as FskMode)}
            className="rounded-md border border-grid bg-void px-2 py-1 font-mono text-xs"
            disabled={active !== null}
          >
            <option value="robust">robust · 15 ms/symbol</option>
            <option value="fast">fast · 6 ms/symbol</option>
          </select>
        </label>
        <p className="font-mono text-xs text-mute">
          Both devices must use the same mode. Put the phone in airplane mode: nothing goes through the network.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {role === "emitter" ? (
          <section className="panel flex flex-col gap-4 p-4">
            <h2 className="panel-title">Field emitter</h2>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-void/60 p-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={active !== null}
                  onClick={() => setPresetId(p.id)}
                  className={`rounded-md px-2 py-1.5 text-[12px] ${p.id === presetId ? "bg-phosphor/15 text-phosphor ring-1 ring-phosphor/40" : "text-mute"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {encoded.ok ? (
              <p className="font-mono text-xs text-mute">
                Frame {encoded.value.frameLen} B · signed {keyInfo.fingerprint} · burst {burstSeconds.toFixed(1)} s
              </p>
            ) : (
              <p className="font-mono text-xs text-alarm">{encoded.error.message}</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={active === "sound" ? stopAll : emitSound}
                disabled={!encoded.ok || (active !== null && active !== "sound")}
                className="rounded-lg border border-phosphor/50 px-3 py-3 text-sm text-phosphor hover:bg-phosphor/10 disabled:opacity-40"
              >
                {active === "sound" ? "Stop sound" : "Send over the speaker"}
              </button>
              <button
                type="button"
                onClick={emitQr}
                disabled={!encoded.ok || active !== null}
                className="rounded-lg border border-ion/50 px-3 py-3 text-sm text-ion hover:bg-ion/10 disabled:opacity-40"
              >
                Show the full-screen QR stream
              </button>
            </div>
            <SpectrogramCanvas core={core} ref={spectro} syncLocked={false} caption="emitted signal" />
            <p className="font-mono text-xs text-mute">Status: {status}</p>
          </section>
        ) : (
          <section className="panel flex flex-col gap-4 p-4">
            <h2 className="panel-title">Field receiver</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={active === "mic" ? stopAll : listen}
                disabled={active !== null && active !== "mic"}
                className="rounded-lg border border-phosphor/50 px-3 py-3 text-sm text-phosphor hover:bg-phosphor/10 disabled:opacity-40"
              >
                {active === "mic" ? "Stop listening" : "Listen (microphone)"}
              </button>
              <button
                type="button"
                onClick={active === "camera" ? stopAll : scan}
                disabled={active !== null && active !== "camera"}
                className="rounded-lg border border-ion/50 px-3 py-3 text-sm text-ion hover:bg-ion/10 disabled:opacity-40"
              >
                {active === "camera" ? "Stop camera" : "Scan the screen (camera)"}
              </button>
            </div>
            <SpectrogramCanvas core={core} ref={spectro} syncLocked={micStatus === "sync" || micStatus === "decoded"} caption="microphone" />
            <video ref={video} className={`w-full rounded-lg border border-grid ${active === "camera" ? "block" : "hidden"}`} muted playsInline />
            <FountainGridCanvas view={fountain} />
            <p className="font-mono text-xs text-mute">Status: {status}</p>
          </section>
        )}

        <section className="panel p-4">
          <h2 className="panel-title mb-3">Verdict</h2>
          <ResultCard verification={verdict?.v ?? null} channel={verdict?.channel ?? (role === "emitter" ? "(this device sends)" : "microphone or camera")} />
        </section>
      </div>

      {fullscreenQr && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#e9fff3]" role="dialog" aria-label="Full-screen QR stream">
          <canvas ref={qrCanvas} className="pixelated aspect-square w-[min(80vh,92vw)]" />
          <p className="font-mono text-sm text-[#04150c]">
            Droplet #{qrIndex} · 8 FPS · {keyInfo.fingerprint}
          </p>
          <button type="button" onClick={stopAll} className="rounded-lg bg-[#04150c] px-4 py-2 text-sm text-[#e9fff3]">
            Close
          </button>
        </div>
      )}
    </div>
  );
}
