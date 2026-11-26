// Chimera Turbo: one frame, two channels, one decoder. The same wide-fountain
// encoder feeds ChromaCrypt matrices (light, ~15 per second) and OFDM bundles
// of whole droplets (sound, ~1 droplet per second, seeds from
// limits.chimeraSoundSeedBase). Every droplet lands in the same ChromaRx, so
// covering the camera or jamming the speaker slows the transfer but never
// restarts it. Splitting bundles, CRC checks and the fountain run in WASM.
import { playBurst, runAcousticLoopback, type AcousticTick } from "./audio-engine";
import { chromaBroadcast, drawChroma, sessionFor } from "./chroma-engine";
import type { WideStep } from "./types";
import type { Core, Result } from "./wasm-bridge";

/** Droplets per OFDM burst: ~1 KB, a ≈ 2.3 s burst. */
export const DROPLETS_PER_BURST = 2;

export type TurboLane = "light" | "sound";

export interface TurboTick {
  lane: TurboLane;
  /** Light: this matrix was lost (drop rate or covered camera). Sound: the burst did not decode. */
  lost: boolean;
  step: WideStep | null;
  lightDroplets: number;
  soundDroplets: number;
  elapsedMs: number;
}

export interface TurboOptions {
  canvas: HTMLCanvasElement;
  fps: number;
  /** Share of matrices lost by the virtual camera, in %. */
  dropPct: number;
  /** White noise on the virtual air, in dB SNR. */
  snrDb: number;
  seed: number;
  dropletsPerBurst?: number;
  /** Sabotage, polled live: while true, every matrix is lost. */
  lightBlocked?: () => boolean;
  /** Sabotage, polled live: once true during a burst, the rest of it is drowned. */
  soundJammed?: () => boolean;
  signal?: AbortSignal;
  onTick?: (t: TurboTick) => void;
  onAudio?: (t: AcousticTick) => void;
}

export interface TurboOutcome {
  result: Result<Uint8Array>;
  k: number;
  lightDroplets: number;
  soundDroplets: number;
  matricesShown: number;
  bursts: number;
  elapsedMs: number;
  kbps: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function aborted(): DOMException {
  return new DOMException("Transmission cancelled", "AbortError");
}

/** Virtual Chimera Turbo: real matrix rendering and reading, real OFDM synthesis and decoding, both at once. */
export async function runChimeraTurbo(core: Core, frame: Uint8Array, opts: TurboOptions): Promise<TurboOutcome> {
  const t0 = performance.now();
  const txRes = core.chromaTx(frame, sessionFor(core, frame));
  if (!txRes.ok) return { result: txRes, k: 0, lightDroplets: 0, soundDroplets: 0, matricesShown: 0, bursts: 0, elapsedMs: 0, kbps: 0 };
  const tx = txRes.value;
  const k = tx.k();
  const rx = core.chromaRx();
  const palette = core.chromaPalette();
  const grid = core.limits.chromaGrid;
  const per = Math.max(1, opts.dropletsPerBurst ?? DROPLETS_PER_BURST);
  const base = core.limits.chimeraSoundSeedBase >>> 0;
  const ctx = opts.canvas.getContext("2d", { willReadFrequently: true });
  const stop = new AbortController();
  const onOuterAbort = () => stop.abort();
  opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
  let lightDroplets = 0;
  let soundDroplets = 0;
  let shown = 0;
  let bursts = 0;
  let complete = false;
  const tick = (lane: TurboLane, lost: boolean, step: WideStep | null) => {
    if (step?.complete) complete = true;
    opts.onTick?.({ lane, lost, step, lightDroplets, soundDroplets, elapsedMs: performance.now() - t0 });
    if (complete) stop.abort();
  };

  const light = async () => {
    const interval = 1000 / opts.fps;
    for (let i = 0; i < k * 8 && !stop.signal.aborted; i++) {
      const start = performance.now();
      drawChroma(opts.canvas, tx.cells(i >>> 0), grid, palette);
      shown++;
      const covered = opts.lightBlocked?.() ?? false;
      if (covered && ctx) {
        // What the camera sees with a hand over it.
        ctx.fillStyle = "rgba(8, 6, 12, 0.92)";
        ctx.fillRect(0, 0, opts.canvas.width, opts.canvas.height);
      }
      let step: WideStep | null = null;
      const lost = covered || core.isDropped(opts.seed, i, opts.dropPct);
      if (!lost && ctx) {
        const img = ctx.getImageData(0, 0, opts.canvas.width, opts.canvas.height);
        const scan = rx.scan(img.data, img.width, img.height);
        if (scan.ok && scan.value.step) {
          step = scan.value.step;
          lightDroplets++;
        }
      }
      tick("light", lost, step);
      await sleep(interval - (performance.now() - start));
    }
  };

  const sound = async () => {
    // Enough bursts to rebuild the frame from sound alone, with margin.
    const maxBursts = Math.ceil((k * 3) / per) + 4;
    for (let b = 0; b < maxBursts && !stop.signal.aborted; b++) {
      const bundle = tx.bundle((base + b * per) >>> 0, per);
      bursts++;
      let step: WideStep | null = null;
      let lost = true;
      try {
        const out = await runAcousticLoopback(core, bundle, {
          mode: "ofdm",
          snrDb: opts.snrDb,
          seed: (opts.seed ^ (b * 0x9e37)) >>> 0,
          playAudio: false,
          signal: stop.signal,
          onTick: opts.onAudio,
          jammed: opts.soundJammed,
        });
        if (out.result.ok) {
          const got = rx.ingestBundle(out.result.value.frame);
          if (got.ok) {
            soundDroplets += got.value.accepted;
            step = got.value.step ?? null;
            lost = got.value.accepted === 0;
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        throw e;
      }
      tick("sound", lost, step);
    }
  };

  try {
    const lanes = await Promise.allSettled([light(), sound()]);
    const failed = lanes.find((l): l is PromiseRejectedResult => l.status === "rejected");
    if (opts.signal?.aborted) throw aborted();
    if (failed && !complete) throw failed.reason;
    const elapsedMs = performance.now() - t0;
    const result: Result<Uint8Array> = complete
      ? rx.frame()
      : { ok: false, error: { code: "FOUNTAIN_INCOMPLETE", message: `Frame not rebuilt: ${lightDroplets} droplet(s) by light, ${soundDroplets} by sound for K = ${k}` } };
    return { result, k, lightDroplets, soundDroplets, matricesShown: shown, bursts, elapsedMs, kbps: complete ? (frame.length * 8) / elapsedMs : 0 };
  } finally {
    opts.signal?.removeEventListener("abort", onOuterAbort);
    stop.abort();
    rx.free();
    tx.free();
  }
}

/**
 * Field emitter: loops ChromaCrypt matrices on `canvas` and, at the same time,
 * OFDM bundles of droplets on the speaker, until `signal` aborts.
 */
export async function chimeraBroadcast(
  core: Core,
  frame: Uint8Array,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  opts: { fps?: number; dropletsPerBurst?: number; onMatrix?: (index: number, k: number) => void; onBurst?: (index: number) => void } = {},
): Promise<void> {
  const txRes = core.chromaTx(frame, sessionFor(core, frame));
  if (!txRes.ok) throw new Error(txRes.error.message);
  const tx = txRes.value;
  const per = Math.max(1, opts.dropletsPerBurst ?? DROPLETS_PER_BURST);
  const base = core.limits.chimeraSoundSeedBase >>> 0;
  const speaker = (async () => {
    for (let b = 0; !signal.aborted; b++) {
      opts.onBurst?.(b);
      try {
        await playBurst(core, tx.bundle((base + b * per) >>> 0, per), "ofdm", { signal });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        throw e;
      }
      await sleep(150);
    }
  })();
  try {
    await Promise.all([chromaBroadcast(core, frame, canvas, opts.fps ?? 12, signal, opts.onMatrix), speaker]);
  } finally {
    tx.free();
  }
}

/** True when bytes decoded from an OFDM burst are a Chimera droplet bundle (wide-fountain magic "GW"). */
export function isBundle(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x47 && bytes[1] === 0x57;
}
