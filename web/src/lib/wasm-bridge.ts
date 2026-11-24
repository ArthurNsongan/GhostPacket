// Single entry point to the WASM core (see .kiro/steering/structure.md).
// - Loads the binary from this origin only (no CDN, works offline: US-04).
// - Times every call so the UI can show the < 500 ms budget.
// - Converts WASM errors `{ code, message }` into typed results.
import init, * as wasm from "../wasm/ghostpacket_core.js";
import {
  FSK_MODE_CODE,
  isGhostError,
  type DocumentDraft,
  type DropletStep,
  type EncodedFrame,
  type FrameInspection,
  type FskDecodeResult,
  type FskMode,
  type GhostError,
  type KeyInfo,
  type Limits,
  type VerifiedFrame,
} from "./types";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export type Result<T> = { ok: true; value: T } | { ok: false; error: GhostError };

export interface Timing {
  op: string;
  ms: number;
  at: number;
}

/** One bounded buffer per operation, so frequent ops (FFT) never evict rare ones (encode). */
const timings = new Map<string, Timing[]>();
const PER_OP = 200;
const listeners = new Set<(t: Timing) => void>();

export function onTiming(fn: (t: Timing) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function recentTimings(op?: string): Timing[] {
  if (op) return [...(timings.get(op) ?? [])];
  return [...timings.values()].flat().sort((a, b) => a.at - b.at);
}

export function medianMs(op: string): number | null {
  const v = (timings.get(op) ?? []).map((t) => t.ms).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? (v[m] ?? null) : ((v[m - 1] ?? 0) + (v[m] ?? 0)) / 2;
}

function record(t: Timing): void {
  const list = timings.get(t.op) ?? [];
  list.push(t);
  if (list.length > PER_OP) list.shift();
  timings.set(t.op, list);
  listeners.forEach((l) => l(t));
}

function timed<T>(op: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    record({ op, ms: performance.now() - t0, at: Date.now() });
  }
}

function toError(e: unknown): GhostError {
  if (isGhostError(e)) return { code: e.code, message: e.message };
  return { code: "WASM_ERROR", message: e instanceof Error ? e.message : String(e) };
}

function attempt<T>(op: string, fn: () => T): Result<T> {
  try {
    return { ok: true, value: timed(op, fn) };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

let loading: Promise<Core> | null = null;

/** Loads the WASM core once. Safe to call from many components. */
export function loadCore(): Promise<Core> {
  loading ??= (async () => {
    const t0 = performance.now();
    await init({ module_or_path: `${BASE_PATH}/wasm/ghostpacket_core_bg.wasm` });
    const core = new Core();
    record({ op: "wasm_load", ms: performance.now() - t0, at: Date.now() });
    return core;
  })();
  return loading;
}

export class Core {
  readonly version = wasm.core_version();
  readonly limits = wasm.limits() as Limits;

  keyInfo(seed: Uint8Array): Result<KeyInfo> {
    return attempt("key_info", () => wasm.key_info(seed) as KeyInfo);
  }

  encode(draft: DocumentDraft, seed: Uint8Array, flags: number): Result<EncodedFrame> {
    return attempt("encode", () => wasm.encode_document(draft, seed, flags) as EncodedFrame);
  }

  verify(frame: Uint8Array, trustedHex: string[] = []): Result<VerifiedFrame> {
    return attempt("verify", () => wasm.decode_frame(frame, trustedHex) as VerifiedFrame);
  }

  inspect(frame: Uint8Array): FrameInspection {
    return timed("inspect", () => wasm.inspect_frame(frame) as FrameInspection);
  }

  flipBit(frame: Uint8Array, byte: number, bit: number): Result<Uint8Array> {
    return attempt("flip_bit", () => wasm.flip_bit(frame, byte, bit));
  }

  crc32(data: Uint8Array): number {
    return wasm.crc32(data);
  }

  fskModulate(frame: Uint8Array, sampleRate: number, mode: FskMode): Result<Float32Array> {
    return attempt("fsk_modulate", () => wasm.fsk_modulate(frame, sampleRate, FSK_MODE_CODE[mode]));
  }

  fskDemodulate(samples: Float32Array, sampleRate: number, mode: FskMode): Result<FskDecodeResult> {
    return attempt("fsk_demodulate", () => wasm.fsk_demodulate(samples, sampleRate, FSK_MODE_CODE[mode]) as FskDecodeResult);
  }

  fskBurstSeconds(frameLen: number, mode: FskMode): number {
    return wasm.fsk_burst_seconds(frameLen, FSK_MODE_CODE[mode]);
  }

  injectNoise(samples: Float32Array, snrDb: number, seed: number): Float32Array {
    return timed("awgn", () => wasm.inject_awgn(samples, snrDb, seed >>> 0));
  }

  isDropped(seed: number, index: number, dropPct: number): boolean {
    return wasm.is_dropped(seed >>> 0, index >>> 0, dropPct);
  }

  spectrum(size = 1024): SpectrumAnalyzer {
    return new SpectrumAnalyzer(new wasm.Spectrum(size));
  }

  fountainTx(frame: Uint8Array, session: number, blockSize = 16): Result<wasm.FountainTx> {
    return attempt("fountain_tx", () => new wasm.FountainTx(frame, session & 0xffff, blockSize));
  }

  fountainRx(): FountainReceiver {
    return new FountainReceiver(new wasm.FountainRx());
  }
}

export class SpectrumAnalyzer {
  constructor(private readonly inner: wasm.Spectrum) {}

  compute(samples: Float32Array): Float32Array {
    return timed("fft", () => this.inner.compute(samples));
  }

  free(): void {
    this.inner.free();
  }
}

export class FountainReceiver {
  constructor(private readonly inner: wasm.FountainRx) {}

  ingest(droplet: Uint8Array): Result<DropletStep> {
    return attempt("droplet_ingest", () => this.inner.ingest(droplet) as DropletStep);
  }

  frame(): Result<Uint8Array> {
    return attempt("fountain_frame", () => this.inner.frame());
  }

  reset(): void {
    this.inner.reset();
  }

  free(): void {
    this.inner.free();
  }
}

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0").toUpperCase();
  return s;
}

export function fromHex(hex: string): Uint8Array | null {
  const clean = hex.trim();
  if (!/^[0-9A-Fa-f]*$/.test(clean) || clean.length % 2 !== 0) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 32 random bytes from the browser CSPRNG; never leaves this tab. */
export function newSigningSeed(): Uint8Array {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return seed;
}
