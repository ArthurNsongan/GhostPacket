"use client";

// Reusable air-gap transfer blocks for every app of the skeleton:
// - AirSender: speaker burst (4-FSK or OFDM) or full-screen stream (fountain QR
//   or ChromaCrypt color matrices);
// - AirReceiver: microphone or camera, hands each rebuilt frame to the app;
// - VirtualHandover: the same screen → camera path in software (a share of
//   frames lost), for a judge with one device and no permissions.
// All DSP and decoding run in WASM through the SDK; these only move pixels and samples.
import { useEffect, useRef, useState } from "react";

import { MicReceiver, playBurst, type MicStatus } from "ghostpacket-sdk/audio-engine";
import { chromaBroadcast, ChromaScanner, runChromaLoopback } from "ghostpacket-sdk/chroma-engine";
import { emitLevel, spectral } from "ghostpacket-sdk/effects";
import { broadcast, CameraScanner, runOpticalLoopback } from "ghostpacket-sdk/optical-engine";
import type { AcousticMode, Channel, FskMode } from "ghostpacket-sdk/types";
import { sfx } from "ghostpacket-sdk/ui-sfx";
import type { ChromaReceiver, FountainReceiver } from "ghostpacket-sdk/wasm-bridge";

import FountainGridCanvas, { EMPTY_FOUNTAIN, type FountainView } from "./FountainGridCanvas";
import type { GhostState } from "./GhostContext";
import SpectrogramCanvas, { type SignalSink } from "./SpectrogramCanvas";

const btn = "rounded-lg px-3 py-3 text-sm transition disabled:opacity-40";
const select = "rounded-md bg-ink/[0.045] px-2 py-1 font-mono text-[11px] text-ink outline-none focus:bg-ink/[0.08]";

export type LightMode = "qr" | "chroma";

/** Frames over 512 B (GPKT v2) only fit OFDM (≤ 16 KB) and ChromaCrypt (≤ 128 KB). */
const V1_MAX = 512;
const OFDM_MAX = 16 * 1024;

function mediaProblem(e: unknown): string | null {
  if (e instanceof DOMException && ["NotAllowedError", "NotFoundError", "NotReadableError", "SecurityError", "OverconstrainedError", "NotSupportedError"].includes(e.name)) return e.name;
  if (e instanceof TypeError) return "HTTPS required";
  return null;
}

function soundOptions(len: number): { id: AcousticMode; label: string; ok: boolean }[] {
  return [
    { id: "robust", label: "4-FSK robust · 133 bit/s", ok: len <= V1_MAX },
    { id: "fast", label: "4-FSK fast · 333 bit/s", ok: len <= V1_MAX },
    { id: "ofdm", label: "OFDM chord · ≈ 4 kbit/s", ok: len <= OFDM_MAX },
  ];
}

function lightOptions(len: number): { id: LightMode; label: string; ok: boolean }[] {
  return [
    { id: "qr", label: "Fountain QR", ok: len <= V1_MAX },
    { id: "chroma", label: "ChromaCrypt color matrix", ok: true },
  ];
}

function firstOk<T extends string>(opts: { id: T; ok: boolean }[], wanted: T): T {
  return opts.find((o) => o.id === wanted && o.ok)?.id ?? opts.find((o) => o.ok)?.id ?? wanted;
}

export function AirSender({ ghost, frame, mode, caption }: { ghost: GhostState; frame: Uint8Array | null; mode: FskMode; caption?: string }) {
  const { core, keyInfo } = ghost;
  const len = frame?.length ?? 0;
  const [sound, setSound] = useState<AcousticMode>(mode);
  const [light, setLight] = useState<LightMode>("qr");
  const [active, setActive] = useState<"sound" | "light" | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [index, setIndex] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const spectro = useRef<SignalSink>(null);
  const soundMode = firstOk(soundOptions(len), sound);
  const lightMode = firstOk(lightOptions(len), light);
  useEffect(() => setSound(mode), [mode]);

  const stop = () => {
    abort.current?.abort();
    abort.current = null;
    setActive(null);
  };
  useEffect(() => () => abort.current?.abort(), []);

  const seconds = frame ? (soundMode === "ofdm" ? core.ofdmBurstSeconds(len) : core.fskBurstSeconds(len, soundMode)) : 0;
  const soundOk = soundOptions(len).some((o) => o.id === soundMode && o.ok);

  const sendSound = async () => {
    if (!frame || !soundOk) return;
    stop();
    setActive("sound");
    setProgress(0);
    const ac = new AbortController();
    abort.current = ac;
    // Visual cue only: no sound effect right before a real speaker burst.
    spectral("transmit");
    setStatus(`sending over the speaker · ${soundMode} · ${seconds.toFixed(1)} s`);
    try {
      const res = await playBurst(core, frame, soundMode, {
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

  const sendLight = () => {
    if (!frame) return;
    stop();
    setActive("light");
    spectral("transmit");
    void sfx("summon");
    abort.current = new AbortController();
    const signal = abort.current.signal;
    requestAnimationFrame(() => {
      const c = canvas.current;
      if (!c) return;
      const run = lightMode === "chroma" ? chromaBroadcast(core, frame, c, 12, signal, (i) => setIndex(i)) : broadcast(core, frame, c, 8, signal, (i) => setIndex(i));
      run.catch((e: unknown) => setStatus(String(e)));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-[11px] text-mute">
          sound
          <select value={soundMode} onChange={(e) => setSound(e.target.value as AcousticMode)} disabled={active !== null} className={select} aria-label="Acoustic modem">
            {soundOptions(len).map((o) => (
              <option key={o.id} value={o.id} disabled={!o.ok}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[11px] text-mute">
          light
          <select value={lightMode} onChange={(e) => setLight(e.target.value as LightMode)} disabled={active !== null} className={select} aria-label="Optical transport">
            {lightOptions(len).map((o) => (
              <option key={o.id} value={o.id} disabled={!o.ok}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={active === "sound" ? stop : sendSound} disabled={!frame || !soundOk || active === "light"} className={`${btn} bg-phosphor/10 text-phosphor hover:bg-phosphor/20`}>
          {active === "sound" ? "Stop sound" : `Send over the speaker${frame ? ` (${seconds.toFixed(1)} s)` : ""}`}
        </button>
        <button type="button" onClick={sendLight} disabled={!frame || active !== null} className={`${btn} bg-ion/10 text-ion hover:bg-ion/20`}>
          Show the full-screen {lightMode === "chroma" ? "color-matrix" : "QR"} stream
        </button>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-void" aria-label="Burst progress">
        <div className="h-full bg-phosphor transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
      </div>
      {active === "sound" && <SpectrogramCanvas core={core} ref={spectro} syncLocked={false} caption="emitted signal" />}
      {status && <p className="font-mono text-xs text-mute">{status}</p>}
      {active === "light" && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white" role="dialog" aria-label="Full-screen optical stream">
          <canvas ref={canvas} width={lightMode === "chroma" ? 936 : 600} height={lightMode === "chroma" ? 936 : 600} className="pixelated aspect-square w-[min(80vh,92vw)]" />
          <p className="font-mono text-sm text-[#04150c]">
            {caption ?? "GhostPacket"} · {lightMode === "chroma" ? "ChromaCrypt" : "QR"} #{index} · {len} B · {keyInfo.fingerprint}
          </p>
          <button type="button" onClick={stop} className="rounded-lg bg-[#04150c] px-4 py-2 text-sm text-[#e9fff3]">
            Close
          </button>
        </div>
      )}
    </div>
  );
}

export function AirReceiver({
  ghost,
  mode,
  onFrame,
  onPartial,
}: {
  ghost: GhostState;
  mode: FskMode;
  onFrame: (frame: Uint8Array, channel: Channel) => void;
  /** ChromaCrypt only: decoded-block map while a large frame arrives. */
  onPartial?: (decoded: boolean[]) => void;
}) {
  const { core } = ghost;
  const [sound, setSound] = useState<AcousticMode>(mode);
  const [light, setLight] = useState<LightMode>("qr");
  const [active, setActive] = useState<"mic" | "camera" | null>(null);
  const [status, setStatus] = useState("");
  const [micStatus, setMicStatus] = useState<MicStatus | null>(null);
  const [fountain, setFountain] = useState<FountainView>(EMPTY_FOUNTAIN);
  const spectro = useRef<SignalSink>(null);
  const video = useRef<HTMLVideoElement>(null);
  const mic = useRef<MicReceiver | null>(null);
  const cam = useRef<CameraScanner | ChromaScanner | null>(null);
  const rx = useRef<FountainReceiver | ChromaReceiver | null>(null);
  const deliver = useRef(onFrame);
  deliver.current = onFrame;
  const partial = useRef(onPartial);
  partial.current = onPartial;
  useEffect(() => setSound(mode), [mode]);

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
    const receiver = new MicReceiver(core, sound, {
      onTick: (t) => {
        spectro.current?.push(t.window, t.sampleRate);
        emitLevel(t.window);
      },
      onStatus: (s, d) => {
        setMicStatus(s);
        if (d) setStatus(d);
      },
      onFrame: (frame, info) => {
        setStatus(`frame received (${frame.length} B) · ${info.meanSymbolSnrDb.toFixed(1)} dB · ${info.correctedBytes} byte(s) fixed`);
        deliver.current(frame, sound === "ofdm" ? "ofdm" : "sound");
      },
    });
    mic.current = receiver;
    try {
      await receiver.start();
      setStatus(`listening (${sound})`);
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
    let shown = 0;
    const view = (s: { totalK: number; resolvedCount: number; newlyResolved: number[]; cascadeDepth: number; solvedByElimination: boolean; dropletsReceived: number; pending: number; complete: boolean }, decoded: boolean[]) =>
      setFountain((v) => ({
        k: s.totalK,
        decoded,
        flash: s.newlyResolved,
        cascadeDepth: Math.max(v.cascadeDepth, s.cascadeDepth),
        byElimination: v.byElimination || s.solvedByElimination,
        shown,
        received: s.dropletsReceived,
        pending: s.pending,
        complete: s.complete,
      }));
    try {
      if (light === "chroma") {
        const receiver = core.chromaRx();
        rx.current = receiver;
        const scanner = new ChromaScanner(video.current, receiver, (res) => {
          shown++;
          const s = res.step;
          if (!s) return;
          const decoded = Array.from(receiver.decodedMap(), (b) => b === 1);
          view(s, decoded);
          partial.current?.(decoded);
          if (s.complete) {
            const frame = receiver.frame();
            stop();
            if (frame.ok) deliver.current(frame.value, "chroma");
            else setStatus(`${frame.error.code}: ${frame.error.message}`);
          }
        });
        cam.current = scanner;
        await scanner.start();
        setStatus("camera on · ChromaCrypt reader (WASM)");
      } else {
        const receiver = core.fountainRx();
        rx.current = receiver;
        const scanner = new CameraScanner(video.current, receiver, (step) => {
          shown++;
          if (!step.ok) return;
          view(step.value, step.value.decoded);
          if (step.value.complete) {
            const frame = receiver.frame();
            stop();
            if (frame.ok) deliver.current(frame.value, "light");
            else setStatus(`${frame.error.code}: ${frame.error.message}`);
          }
        });
        cam.current = scanner;
        await scanner.start();
        setStatus(`camera on · decoder ${scanner.engine}`);
      }
    } catch (e) {
      stop();
      const p = mediaProblem(e);
      setStatus(p ? `Camera unavailable (${p}). Use the virtual hand-over instead.` : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-[11px] text-mute">
          sound
          <select value={sound} onChange={(e) => setSound(e.target.value as AcousticMode)} disabled={active !== null} className={select} aria-label="Acoustic modem to listen for">
            {soundOptions(0).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[11px] text-mute">
          light
          <select value={light} onChange={(e) => setLight(e.target.value as LightMode)} disabled={active !== null} className={select} aria-label="Optical transport to scan">
            {lightOptions(0).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={active === "mic" ? stop : listen} disabled={active === "camera"} className={`${btn} bg-phosphor/10 text-phosphor hover:bg-phosphor/20`}>
          {active === "mic" ? "Stop listening" : "Listen (microphone)"}
        </button>
        <button type="button" onClick={active === "camera" ? stop : () => void scan()} disabled={active === "mic"} className={`${btn} bg-ion/10 text-ion hover:bg-ion/20`}>
          {active === "camera" ? "Stop camera" : "Scan the screen (camera)"}
        </button>
      </div>
      {active === "mic" && <SpectrogramCanvas core={core} ref={spectro} syncLocked={micStatus === "sync" || micStatus === "decoded"} caption="microphone" />}
      <video ref={video} className={`w-full rounded-lg ${active === "camera" ? "block" : "hidden"}`} muted playsInline />
      {(active === "camera" || fountain.k > 0) && <FountainGridCanvas view={fountain} />}
      {status && <p className="font-mono text-xs text-mute">{status}</p>}
    </div>
  );
}

/** Software screen → camera hand-over: real rendering and reading, a share of frames lost. */
export function VirtualHandover({
  ghost,
  frame,
  onFrame,
  onPartial,
  dropPct = 30,
  transport,
  label = "Simulate the hand-over (no hardware)",
}: {
  ghost: GhostState;
  frame: Uint8Array | null;
  onFrame: (frame: Uint8Array, channel: Channel) => void;
  onPartial?: (decoded: boolean[]) => void;
  dropPct?: number;
  /** Default: fountain QR for v1 frames, ChromaCrypt for larger ones. */
  transport?: LightMode;
  label?: string;
}) {
  const { core } = ghost;
  const canvas = useRef<HTMLCanvasElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [fountain, setFountain] = useState<FountainView>(EMPTY_FOUNTAIN);
  const [status, setStatus] = useState("");
  useEffect(() => () => abort.current?.abort(), []);
  const mode: LightMode = transport ?? ((frame?.length ?? 0) > V1_MAX ? "chroma" : "qr");

  const run = async () => {
    if (!frame || !canvas.current) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    setFountain(EMPTY_FOUNTAIN);
    spectral("transmit");
    void sfx("summon");
    let shown = 0;
    let lost = 0;
    let blocks: boolean[] = [];
    const dropped = () => {
      lost++;
      spectral("drop");
      void sfx("drop");
    };
    try {
      if (mode === "chroma") {
        const out = await runChromaLoopback(core, frame, {
          canvas: canvas.current,
          fps: 15,
          dropPct,
          seed: core.crc32(frame) & 0xffff,
          signal: ac.signal,
          onTick: (t) => {
            shown++;
            if (t.dropped) dropped();
            const s = t.step;
            if (!s) return;
            // Decoded-block map rebuilt from the step counts (the receiver lives inside the loopback).
            // Built here, not in the state updater, so the parent callback runs once per tick.
            if (blocks.length !== s.totalK) blocks = Array<boolean>(s.totalK).fill(false);
            else blocks = [...blocks];
            for (const i of s.newlyResolved) blocks[i] = true;
            const decoded = blocks;
            onPartial?.(decoded);
            setFountain((v) => {
              return {
                k: s.totalK,
                decoded,
                flash: s.newlyResolved,
                cascadeDepth: Math.max(v.cascadeDepth, s.cascadeDepth),
                byElimination: v.byElimination || s.solvedByElimination,
                shown,
                received: s.dropletsReceived,
                pending: s.pending,
                complete: s.complete,
              };
            });
          },
        });
        setStatus(`ChromaCrypt · ${shown} matrices shown · ${lost} lost (${dropPct} %) · ${frame.length} B in ${(out.elapsedMs / 1000).toFixed(1)} s · ${out.kbps.toFixed(1)} kbit/s`);
        if (out.result.ok) onFrame(out.result.value, "chroma");
        else setStatus(`${out.result.error.code}: ${out.result.error.message}`);
      } else {
        const out = await runOpticalLoopback(core, frame, {
          fps: 14,
          dropPct,
          seed: core.crc32(frame) & 0xffff,
          canvas: canvas.current,
          signal: ac.signal,
          onTick: (t) => {
            shown++;
            if (t.dropped) dropped();
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
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setStatus(String(e));
    } finally {
      setRunning(false);
    }
  };

  const side = mode === "chroma" ? 300 : 148;
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={run} disabled={!frame || running} className="cta-ember px-5 py-3 text-sm font-semibold disabled:opacity-50">
        {running ? "Handing over…" : `▶ ${label}`}
      </button>
      <div className={`grid items-start gap-3 ${mode === "chroma" ? "lg:grid-cols-[300px_1fr]" : "sm:grid-cols-[148px_1fr]"} ${running || fountain.k > 0 ? "" : "hidden"}`}>
        <canvas ref={canvas} width={side} height={side} className="pixelated w-full max-w-[300px] rounded-md bg-white" aria-label={mode === "chroma" ? "Virtual ChromaCrypt stream" : "Virtual QR stream"} />
        <FountainGridCanvas view={fountain} />
      </div>
      {status && <p className="font-mono text-xs text-mute">{status}</p>}
    </div>
  );
}
