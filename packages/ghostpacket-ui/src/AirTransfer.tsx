"use client";

// Reusable air-gap transfer blocks for every app of the skeleton:
// - AirSender: speaker burst (4-FSK) or full-screen fountain QR stream;
// - AirReceiver: microphone or camera, hands each rebuilt frame to the app;
// - VirtualHandover: the same screen → camera path in software (30 % of QR
//   frames lost), for a judge with one device and no permissions.
// All DSP and decoding run in WASM through the SDK; these only move pixels and samples.
import { useEffect, useRef, useState } from "react";

import { MicReceiver, playBurst, type MicStatus } from "ghostpacket-sdk/audio-engine";
import { emitLevel, spectral } from "ghostpacket-sdk/effects";
import { broadcast, CameraScanner, runOpticalLoopback } from "ghostpacket-sdk/optical-engine";
import type { Channel, FskMode } from "ghostpacket-sdk/types";
import { sfx } from "ghostpacket-sdk/ui-sfx";
import type { FountainReceiver } from "ghostpacket-sdk/wasm-bridge";

import FountainGridCanvas, { EMPTY_FOUNTAIN, type FountainView } from "./FountainGridCanvas";
import type { GhostState } from "./GhostContext";
import SpectrogramCanvas, { type SignalSink } from "./SpectrogramCanvas";

const btn = "rounded-lg border px-3 py-3 text-sm transition disabled:opacity-40";

function mediaProblem(e: unknown): string | null {
  if (e instanceof DOMException && ["NotAllowedError", "NotFoundError", "NotReadableError", "SecurityError", "OverconstrainedError", "NotSupportedError"].includes(e.name)) return e.name;
  if (e instanceof TypeError) return "HTTPS required";
  return null;
}

export function AirSender({ ghost, frame, mode, caption }: { ghost: GhostState; frame: Uint8Array | null; mode: FskMode; caption?: string }) {
  const { core, keyInfo } = ghost;
  const [active, setActive] = useState<"sound" | "qr" | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [qrIndex, setQrIndex] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const qrCanvas = useRef<HTMLCanvasElement>(null);
  const spectro = useRef<SignalSink>(null);

  const stop = () => {
    abort.current?.abort();
    abort.current = null;
    setActive(null);
  };
  useEffect(() => () => abort.current?.abort(), []);

  const sendSound = async () => {
    if (!frame) return;
    stop();
    setActive("sound");
    setProgress(0);
    const ac = new AbortController();
    abort.current = ac;
    // Visual cue only: no sound effect right before a real speaker burst.
    spectral("transmit");
    setStatus(`sending over the speaker · ${mode} · ${core.fskBurstSeconds(frame.length, mode).toFixed(1)} s`);
    try {
      const res = await playBurst(core, frame, mode, {
        signal: ac.signal,
        onTick: (t) => {
          spectro.current?.push(t.window, t.sampleRate);
          emitLevel(t.window);
          setProgress(t.total ? t.cursor / t.total : 0);
        },
      });
      setProgress(1);
      setStatus(res.ok ? "burst sent" : `${res.error.code}: ${res.error.message}`);
    } catch (e) {
      setStatus(e instanceof DOMException && e.name === "AbortError" ? "stopped" : String(e));
    } finally {
      setActive(null);
    }
  };

  const sendQr = () => {
    if (!frame) return;
    stop();
    setActive("qr");
    spectral("transmit");
    void sfx("summon");
    abort.current = new AbortController();
    const signal = abort.current.signal;
    requestAnimationFrame(() => {
      if (!qrCanvas.current) return;
      broadcast(core, frame, qrCanvas.current, 8, signal, (i) => setQrIndex(i)).catch((e: unknown) => setStatus(String(e)));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={active === "sound" ? stop : sendSound} disabled={!frame || active === "qr"} className={`${btn} border-phosphor/50 text-phosphor hover:bg-phosphor/10`}>
          {active === "sound" ? "Stop sound" : "Send over the speaker"}
        </button>
        <button type="button" onClick={sendQr} disabled={!frame || active !== null} className={`${btn} border-ion/50 text-ion hover:bg-ion/10`}>
          Show the full-screen QR stream
        </button>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-void" aria-label="Burst progress">
        <div className="h-full bg-phosphor transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
      </div>
      {active === "sound" && <SpectrogramCanvas core={core} ref={spectro} syncLocked={false} caption="emitted signal" />}
      {status && <p className="font-mono text-xs text-mute">{status}</p>}
      {active === "qr" && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#e9fff3]" role="dialog" aria-label="Full-screen QR stream">
          <canvas ref={qrCanvas} className="pixelated aspect-square w-[min(80vh,92vw)]" />
          <p className="font-mono text-sm text-[#04150c]">
            {caption ?? "GhostPacket"} · droplet #{qrIndex} · 8 FPS · {keyInfo.fingerprint}
          </p>
          <button type="button" onClick={stop} className="rounded-lg bg-[#04150c] px-4 py-2 text-sm text-[#e9fff3]">
            Close
          </button>
        </div>
      )}
    </div>
  );
}

export function AirReceiver({ ghost, mode, onFrame }: { ghost: GhostState; mode: FskMode; onFrame: (frame: Uint8Array, channel: Channel) => void }) {
  const { core } = ghost;
  const [active, setActive] = useState<"mic" | "camera" | null>(null);
  const [status, setStatus] = useState("");
  const [micStatus, setMicStatus] = useState<MicStatus | null>(null);
  const [fountain, setFountain] = useState<FountainView>(EMPTY_FOUNTAIN);
  const spectro = useRef<SignalSink>(null);
  const video = useRef<HTMLVideoElement>(null);
  const mic = useRef<MicReceiver | null>(null);
  const cam = useRef<CameraScanner | null>(null);
  const rx = useRef<FountainReceiver | null>(null);
  const deliver = useRef(onFrame);
  deliver.current = onFrame;

  const stop = () => {
    mic.current?.stop();
    mic.current = null;
    cam.current?.stop();
    cam.current = null;
    rx.current?.free();
    rx.current = null;
    setActive(null);
  };
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const listen = async () => {
    stop();
    setActive("mic");
    const receiver = new MicReceiver(core, mode, {
      onTick: (t) => {
        spectro.current?.push(t.window, t.sampleRate);
        emitLevel(t.window);
      },
      onStatus: (s, d) => {
        setMicStatus(s);
        if (d) setStatus(d);
      },
      onFrame: (frame, info) => {
        setStatus(`frame received · symbol SNR ${info.meanSymbolSnrDb.toFixed(1)} dB · ${info.correctedBytes} byte(s) fixed`);
        deliver.current(frame, "sound");
      },
    });
    mic.current = receiver;
    try {
      await receiver.start();
      setStatus(`listening (${mode} mode)`);
    } catch (e) {
      stop();
      const p = mediaProblem(e);
      setStatus(p ? `Microphone unavailable (${p}). Use the virtual hand-over instead.` : String(e));
    }
  };

  const scan = async () => {
    stop();
    setFountain(EMPTY_FOUNTAIN);
    if (!video.current) return;
    setActive("camera");
    const receiver = core.fountainRx();
    rx.current = receiver;
    let shown = 0;
    const scanner = new CameraScanner(video.current, receiver, (step) => {
      shown++;
      if (!step.ok) return;
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
        stop();
        if (frame.ok) deliver.current(frame.value, "light");
        else setStatus(`${frame.error.code}: ${frame.error.message}`);
      }
    });
    cam.current = scanner;
    try {
      await scanner.start();
      setStatus(`camera on · decoder ${scanner.engine}`);
    } catch (e) {
      stop();
      const p = mediaProblem(e);
      setStatus(p ? `Camera unavailable (${p}). Use the virtual hand-over instead.` : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={active === "mic" ? stop : listen} disabled={active === "camera"} className={`${btn} border-phosphor/50 text-phosphor hover:bg-phosphor/10`}>
          {active === "mic" ? "Stop listening" : "Listen (microphone)"}
        </button>
        <button type="button" onClick={active === "camera" ? stop : () => void scan()} disabled={active === "mic"} className={`${btn} border-ion/50 text-ion hover:bg-ion/10`}>
          {active === "camera" ? "Stop camera" : "Scan the screen (camera)"}
        </button>
      </div>
      {active === "mic" && <SpectrogramCanvas core={core} ref={spectro} syncLocked={micStatus === "sync" || micStatus === "decoded"} caption="microphone" />}
      <video ref={video} className={`w-full rounded-lg border border-grid ${active === "camera" ? "block" : "hidden"}`} muted playsInline />
      {(active === "camera" || fountain.k > 0) && <FountainGridCanvas view={fountain} />}
      {status && <p className="font-mono text-xs text-mute">{status}</p>}
    </div>
  );
}

/** Software screen → camera hand-over: real QR rendering and reading, a share of frames lost. */
export function VirtualHandover({
  ghost,
  frame,
  onFrame,
  dropPct = 30,
  label = "Simulate the hand-over (no hardware)",
}: {
  ghost: GhostState;
  frame: Uint8Array | null;
  onFrame: (frame: Uint8Array, channel: Channel) => void;
  dropPct?: number;
  label?: string;
}) {
  const { core } = ghost;
  const canvas = useRef<HTMLCanvasElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [fountain, setFountain] = useState<FountainView>(EMPTY_FOUNTAIN);
  const [status, setStatus] = useState("");
  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    if (!frame || !canvas.current) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setRunning(true);
    setFountain(EMPTY_FOUNTAIN);
    spectral("transmit");
    void sfx("summon");
    let shown = 0;
    let lost = 0;
    try {
      const out = await runOpticalLoopback(core, frame, {
        fps: 14,
        dropPct,
        seed: core.crc32(frame) & 0xffff,
        canvas: canvas.current,
        signal: abort.current.signal,
        onTick: (t) => {
          shown++;
          if (t.dropped) {
            lost++;
            spectral("drop");
            void sfx("drop");
          }
          const s = t.step;
          if (s) {
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
          }
        },
      });
      setStatus(`${shown} QR shown · ${lost} lost (${dropPct} % loss) · ${(out.elapsedMs / 1000).toFixed(1)} s`);
      if (out.result.ok) onFrame(out.result.value, "light");
      else setStatus(`${out.result.error.code}: ${out.result.error.message}`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setStatus(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={run} disabled={!frame || running} className="cta-ember px-5 py-3 text-sm font-semibold disabled:opacity-50">
        {running ? "Handing over…" : `▶ ${label}`}
      </button>
      <div className={`grid items-start gap-3 sm:grid-cols-[148px_1fr] ${running || fountain.k > 0 ? "" : "hidden"}`}>
        <canvas ref={canvas} width={148} height={148} className="pixelated rounded-md bg-[#e9fff3]" aria-label="Virtual QR stream" />
        <FountainGridCanvas view={fountain} />
      </div>
      {status && <p className="font-mono text-xs text-mute">{status}</p>}
    </div>
  );
}
