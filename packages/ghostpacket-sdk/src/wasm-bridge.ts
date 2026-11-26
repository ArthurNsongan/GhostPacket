// Single entry point to the WASM core (see .kiro/steering/structure.md).
// - Loads the binary from this origin only (no CDN, works offline: US-04).
// - Times every call so the UI can show the < 500 ms budget.
// - Converts WASM errors `{ code, message }` into typed results.
import init, * as wasm from "../wasm/ghostpacket_core.js";
import { assets, configureAssets, type AssetConfig } from "./assets";
import {
  FSK_MODE_CODE,
  isGhostError,
  type DocumentDraft,
  type DropletStep,
  type EncodedFrame,
  type FrameInspection,
  type BundleStep,
  type FskDecodeResult,
  type FskMode,
  type GhostError,
  type KeyInfo,
  type Limits,
  type VerifiedFrame,
  type ChromaScan,
  type OfdmDecodeResult,
  type WideStep,
} from "./types";


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

/** Per-attempt download budgets: a stalled request is aborted and retried instead of waiting forever. */
const FETCH_TIMEOUTS_MS = [12_000, 25_000, 45_000];

/**
 * Downloads the binary and compiles it. In a browser, a URL is fetched here
 * rather than by wasm-bindgen: a first visit can race the service worker
 * installing and claiming the page, and a request (or the streaming compile fed
 * by it) that never settles would leave the app on its loading screen with no
 * error. Each attempt has a deadline and is retried; compiling from bytes avoids
 * `instantiateStreaming` (the binary is small). wasm-bindgen then receives a
 * ready `WebAssembly.Module`, so `init` runs once and cannot be left pending.
 */
async function compileFrom(url: string | URL): Promise<WebAssembly.Module> {
  let lastError: unknown = null;
  for (const [i, ms] of FETCH_TIMEOUTS_MS.entries()) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`no answer after ${ms / 1000} s`)), ms);
    try {
      // After a failed attempt, skip the HTTP cache: it may hold the stalled or truncated copy.
      const r = await fetch(url, { signal: ctrl.signal, cache: i === 0 ? "default" : "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${String(url)}`);
      const bytes = await r.arrayBuffer();
      return await WebAssembly.compile(bytes);
    } catch (e) {
      lastError = ctrl.signal.aborted ? ctrl.signal.reason : e;
    } finally {
      clearTimeout(timer);
    }
  }
  const why = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`could not download the WebAssembly core (${FETCH_TIMEOUTS_MS.length} attempts, last: ${why})`);
}

const inBrowser = typeof window !== "undefined" && typeof fetch === "function";

/**
 * Loads the WASM core once. Safe to call from many components; after a failure,
 * the next call tries again.
 * `wasm` overrides the binary location (URL) or provides its bytes (Node, tests).
 */
export function loadCore(opts: { wasm?: AssetConfig["wasm"] } = {}): Promise<Core> {
  if (opts.wasm !== undefined) configureAssets({ wasm: opts.wasm });
  loading ??= (async () => {
    const t0 = performance.now();
    const source = assets().wasm;
    const isUrl = typeof source === "string" || source instanceof URL;
    const input = inBrowser && isUrl ? await compileFrom(source) : source;
    await init(input === undefined ? undefined : { module_or_path: input });
    const core = new Core();
    record({ op: "wasm_load", ms: performance.now() - t0, at: Date.now() });
    return core;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export class Core {
  readonly version = wasm.core_version();
  readonly limits = wasm.limits() as Limits;

  keyInfo(seed: Uint8Array): Result<KeyInfo> {
    return attempt("key_info", () => wasm.key_info(seed) as KeyInfo);
  }

  /**
   * Seals a document. With `passphrase`, the payload is encrypted
   * (ChaCha20-Poly1305) under a fresh random salt; the salt never repeats, so
   * neither does the key/nonce pair.
   */
  encode(draft: DocumentDraft, seed: Uint8Array, flags: number, passphrase?: string): Result<EncodedFrame> {
    passphrase = normalizePassphrase(passphrase);
    if (passphrase) {
      const salt = new Uint8Array(this.limits.saltLen);
      crypto.getRandomValues(salt);
      return attempt("encode_encrypted", () => wasm.encode_document(draft, seed, flags, passphrase, salt) as EncodedFrame);
    }
    return attempt("encode", () => wasm.encode_document(draft, seed, flags) as EncodedFrame);
  }

  verify(frame: Uint8Array, trustedHex: string[] = [], passphrase?: string): Result<VerifiedFrame> {
    passphrase = normalizePassphrase(passphrase);
    return attempt(passphrase ? "verify_encrypted" : "verify", () => wasm.decode_frame(frame, trustedHex, passphrase || undefined) as VerifiedFrame);
  }

  inspect(frame: Uint8Array, passphrase?: string): FrameInspection {
    passphrase = normalizePassphrase(passphrase);
    return timed("inspect", () => wasm.inspect_frame(frame, passphrase || undefined) as FrameInspection);
  }

  /** Fingerprint of a hex public key; fails on strings that are not a valid Ed25519 point. */
  fingerprintOf(publicKeyHex: string): Result<string> {
    return attempt("fingerprint_of", () => wasm.fingerprint_of(publicKeyHex));
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

  // ---- V3: GPKT v2, identity vault, ChromaCrypt, OFDM ------------------------

  /** Seals a GPKT v2 frame (payload ≤ 128 KB), e.g. a document carrying an image. */
  encodeV2(draft: DocumentDraft, seed: Uint8Array, flags: number, passphrase?: string): Result<EncodedFrame> {
    passphrase = normalizePassphrase(passphrase);
    if (passphrase) {
      const salt = new Uint8Array(this.limits.saltLen);
      crypto.getRandomValues(salt);
      return attempt("encode_v2_encrypted", () => wasm.encode_document_v2(draft, seed, flags, passphrase, salt) as EncodedFrame);
    }
    return attempt("encode_v2", () => wasm.encode_document_v2(draft, seed, flags) as EncodedFrame);
  }

  /** Seals a signing seed in an identity vault (PBKDF2 210k + ChaCha20-Poly1305). */
  vaultSeal(seed: Uint8Array, passphrase: string): Result<Uint8Array> {
    const salt = new Uint8Array(this.limits.saltLen);
    crypto.getRandomValues(salt);
    return attempt("vault_seal", () => wasm.vault_seal(seed, normalizePassphrase(passphrase) ?? "", salt));
  }

  vaultOpen(vault: Uint8Array, passphrase: string): Result<Uint8Array> {
    return attempt("vault_open", () => wasm.vault_open(vault, normalizePassphrase(passphrase) ?? ""));
  }

  vaultIdentity(vault: Uint8Array): Result<KeyInfo> {
    return attempt("vault_identity", () => wasm.vault_identity(vault) as KeyInfo);
  }

  chromaTx(frame: Uint8Array, session: number): Result<wasm.ChromaTx> {
    return attempt("chroma_tx", () => new wasm.ChromaTx(frame, session & 0xffff));
  }

  chromaRx(): ChromaReceiver {
    return new ChromaReceiver(new wasm.ChromaRx());
  }

  /** 8 × [r, g, b] for palette indices 0..7. */
  chromaPalette(): Uint8Array {
    return wasm.chroma_palette();
  }

  ofdmModulate(frame: Uint8Array, sampleRate: number): Result<Float32Array> {
    return attempt("ofdm_modulate", () => wasm.ofdm_modulate(frame, sampleRate));
  }

  ofdmDemodulate(samples: Float32Array, sampleRate: number): Result<OfdmDecodeResult> {
    return attempt("ofdm_demodulate", () => wasm.ofdm_demodulate(samples, sampleRate) as OfdmDecodeResult);
  }

  ofdmBurstSeconds(frameLen: number, sampleRate = 48_000): number {
    return wasm.ofdm_burst_seconds(frameLen, sampleRate);
  }
}

export class ChromaReceiver {
  constructor(private readonly inner: wasm.ChromaRx) {}

  /** Reads one RGBA camera image (never throws on an unreadable picture). */
  scan(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Result<ChromaScan> {
    const bytes = rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    return attempt("chroma_scan", () => this.inner.scan(bytes, width, height) as ChromaScan);
  }

  ingest(droplet: Uint8Array): Result<WideStep> {
    return attempt("chroma_ingest", () => this.inner.ingest(droplet) as WideStep);
  }

  /** Chimera Turbo: every droplet of a bundle decoded from an OFDM burst. */
  ingestBundle(bundle: Uint8Array): Result<BundleStep> {
    return attempt("chroma_ingest_bundle", () => this.inner.ingestBundle(bundle) as BundleStep);
  }

  frame(): Result<Uint8Array> {
    return attempt("chroma_frame", () => this.inner.frame());
  }

  /** Bytes known so far, unknown blocks zero: progressive image reveal only, never verification. */
  partial(): Uint8Array {
    return this.inner.partial();
  }

  decodedMap(): Uint8Array {
    return this.inner.decodedMap();
  }

  reset(): void {
    this.inner.reset();
  }

  free(): void {
    this.inner.free();
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

/**
 * NFC-normalized passphrase: a phone and a PC may encode "é" differently
 * (NFC vs NFD); without this the same typed passphrase would derive another key.
 */
export function normalizePassphrase(p: string | undefined): string | undefined {
  return p ? p.normalize("NFC") : undefined;
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
