// One-click judge scenario (US-01): sign → sound with noise → light with loss →
// verify → 1-bit tamper. Pure orchestration; the UI subscribes via callbacks.
import { runAcousticLoopback, type AcousticTick, type LoopbackOutcome } from "./audio-engine";
import { runOpticalLoopback, type OpticalOutcome, type OpticalTick } from "./optical-engine";
import type { Core, Result } from "./wasm-bridge";
import { FLAG_DEMO, FLAG_FOUNTAIN, FLAG_FSK, type DocumentDraft, type EncodedFrame, type FrameInspection, type VerifiedFrame } from "./types";

export type DemoStep = "idle" | "encode" | "acoustic" | "optical" | "tamper" | "done" | "failed";

export const DEMO_STEPS: { id: Exclude<DemoStep, "idle" | "failed">; label: string }[] = [
  { id: "encode", label: "Ed25519 signature" },
  { id: "acoustic", label: "Sound 4-FSK + noise" },
  { id: "optical", label: "Light QR + loss" },
  { id: "tamper", label: "1-bit curse" },
  { id: "done", label: "Done" },
];

export interface DemoSettings {
  draft: DocumentDraft;
  seed: Uint8Array;
  /** Optional end-to-end encryption of the payload. */
  passphrase?: string;
  /** Full verification (keyring, passphrase, anti-replay ledger) for a received frame. */
  verify: (frame: Uint8Array, channel: "sound" | "light") => Result<VerifiedFrame>;
  snrDb: number;
  dropPct: number;
  fps: number;
  playAudio: boolean;
  qrCanvas: HTMLCanvasElement;
  signal: AbortSignal;
}

export interface TamperOutcome {
  frame: Uint8Array;
  byte: number;
  bit: number;
  inspection: FrameInspection;
  verification: Result<VerifiedFrame>;
}

export interface DemoCallbacks {
  onStep(step: DemoStep): void;
  onEncoded(enc: Result<EncodedFrame>): void;
  onAcousticTick(tick: AcousticTick): void;
  onAcousticDone(outcome: LoopbackOutcome, verification: Result<VerifiedFrame> | null): void;
  onOpticalTick(tick: OpticalTick): void;
  onOpticalDone(outcome: OpticalOutcome, verification: Result<VerifiedFrame> | null): void;
  onTamper(outcome: TamperOutcome): void;
}

export interface DemoSummary {
  ok: boolean;
  totalMs: number;
  failedAt?: DemoStep;
  message?: string;
}

export const DEMO_FLAGS = FLAG_FSK | FLAG_FOUNTAIN | FLAG_DEMO;

/** Flips one payload bit: the CRC32 catches it before the signature check. */
export function tamper(core: Core, frame: Uint8Array, passphrase?: string): TamperOutcome | null {
  const n = frame.length - 76;
  const byte = 8 + Math.floor(n / 2);
  const bit = 3;
  const flipped = core.flipBit(frame, byte, bit);
  if (!flipped.ok) return null;
  return {
    frame: flipped.value,
    byte,
    bit,
    inspection: core.inspect(flipped.value, passphrase),
    verification: core.verify(flipped.value, [], passphrase),
  };
}

export async function runFullDemo(core: Core, s: DemoSettings, cb: DemoCallbacks): Promise<DemoSummary> {
  const t0 = performance.now();
  const fail = (step: DemoStep, message: string): DemoSummary => {
    cb.onStep("failed");
    return { ok: false, totalMs: performance.now() - t0, failedAt: step, message };
  };

  cb.onStep("encode");
  const enc = core.encode(s.draft, s.seed, DEMO_FLAGS, s.passphrase);
  cb.onEncoded(enc);
  if (!enc.ok) return fail("encode", `${enc.error.code}: ${enc.error.message}`);
  const frame = enc.value.frame;
  await pause(500, s.signal);

  cb.onStep("acoustic");
  const acoustic = await runAcousticLoopback(core, frame, {
    mode: "fast",
    snrDb: s.snrDb,
    seed: 0xc0ffee,
    playAudio: s.playAudio,
    signal: s.signal,
    onTick: cb.onAcousticTick,
  });
  const aVerify = acoustic.result.ok ? s.verify(acoustic.result.value.frame, "sound") : null;
  cb.onAcousticDone(acoustic, aVerify);
  if (!acoustic.result.ok) return fail("acoustic", `${acoustic.result.error.code}: ${acoustic.result.error.message}`);
  if (!aVerify?.ok) return fail("acoustic", aVerify ? `${aVerify.error.code}: ${aVerify.error.message}` : "verification unavailable");

  cb.onStep("optical");
  const optical = await runOpticalLoopback(core, frame, {
    fps: s.fps,
    dropPct: s.dropPct,
    seed: 0x5eed,
    canvas: s.qrCanvas,
    signal: s.signal,
    onTick: cb.onOpticalTick,
  });
  const oVerify = optical.result.ok ? s.verify(optical.result.value, "light") : null;
  cb.onOpticalDone(optical, oVerify);
  if (!optical.result.ok) return fail("optical", `${optical.result.error.code}: ${optical.result.error.message}`);
  if (!oVerify?.ok) return fail("optical", oVerify ? `${oVerify.error.code}: ${oVerify.error.message}` : "verification unavailable");
  await pause(400, s.signal);

  cb.onStep("tamper");
  const t = tamper(core, frame, s.passphrase);
  if (!t) return fail("tamper", "flip_bit failed");
  cb.onTamper(t);
  if (t.verification.ok) return fail("tamper", "The corrupted frame was accepted");
  await pause(600, s.signal);

  cb.onStep("done");
  return { ok: true, totalMs: performance.now() - t0 };
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Demo cancelled", "AbortError"));
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new DOMException("Demo cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}
