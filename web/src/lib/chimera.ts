// "Chimera dual-channel race": the same frame goes out over sound and light at
// the same time. The judge can sabotage either channel mid-flight; the first
// channel to deliver a verified frame wins.
import { runAcousticLoopback, type AcousticTick, type LoopbackOutcome } from "./audio-engine";
import { runOpticalLoopback, type OpticalOutcome, type OpticalTick } from "./optical-engine";
import type { Result } from "./wasm-bridge";
import type { Core } from "./wasm-bridge";
import type { VerifiedFrame } from "./types";

export type RaceLane = "sound" | "light";

export interface Sabotage {
  jamAudio: boolean;
  blockCamera: boolean;
}

export interface LaneResult {
  lane: RaceLane;
  ok: boolean;
  ms: number;
  verification: Result<VerifiedFrame> | null;
  detail: string;
}

export interface RaceCallbacks {
  onAcousticTick(t: AcousticTick): void;
  onOpticalTick(t: OpticalTick): void;
  onLaneDone(r: LaneResult, winner: boolean): void;
}

export const BLOCKED_CAMERA_LOSS = 85;

export async function runChimeraRace(
  core: Core,
  frame: Uint8Array,
  s: { snrDb: number; dropPct: number; fps: number; playAudio: boolean; qrCanvas: HTMLCanvasElement; signal: AbortSignal; seed: number },
  sabotage: () => Sabotage,
  verify: (frame: Uint8Array, lane: RaceLane) => Result<VerifiedFrame>,
  cb: RaceCallbacks,
): Promise<{ winner: RaceLane | null; results: LaneResult[]; totalMs: number }> {
  const t0 = performance.now();
  let winner: RaceLane | null = null;
  const results: LaneResult[] = [];

  const finish = (r: LaneResult) => {
    const won = r.ok && winner === null;
    if (won) winner = r.lane;
    results.push(r);
    cb.onLaneDone(r, won);
  };

  const sound = runAcousticLoopback(core, frame, {
    mode: "fast",
    snrDb: s.snrDb,
    seed: s.seed,
    playAudio: s.playAudio,
    signal: s.signal,
    onTick: cb.onAcousticTick,
    jammed: () => sabotage().jamAudio,
  }).then((out: LoopbackOutcome) => {
    const v = out.result.ok ? verify(out.result.value.frame, "sound") : null;
    finish({
      lane: "sound",
      ok: !!v?.ok,
      ms: performance.now() - t0,
      verification: v ?? (out.result.ok ? null : out.result),
      detail: out.result.ok ? `${out.result.value.correctedBytes} byte(s) fixed by Reed-Solomon` : out.result.error.code,
    });
  });

  const light = runOpticalLoopback(core, frame, {
    fps: s.fps,
    dropPct: s.dropPct,
    dropPctNow: () => (sabotage().blockCamera ? BLOCKED_CAMERA_LOSS : s.dropPct),
    // A fresh loss pattern per race: with a fixed seed the same lucky draws repeat.
    seed: (s.seed * 2654435761) >>> 0,
    canvas: s.qrCanvas,
    signal: s.signal,
    onTick: cb.onOpticalTick,
  }).then((out: OpticalOutcome) => {
    const v = out.result.ok ? verify(out.result.value, "light") : null;
    finish({
      lane: "light",
      ok: !!v?.ok,
      ms: performance.now() - t0,
      verification: v ?? (out.result.ok ? null : out.result),
      detail: `${out.received} of ${out.shown} QR frames received (K = ${out.k})`,
    });
  });

  await Promise.all([sound, light]);
  return { winner, results, totalMs: performance.now() - t0 };
}
