// Acoustic channel I/O. All DSP (modulation, noise, demodulation, FFT) runs in
// WASM through wasm-bridge; this module only moves samples around.
import { assets } from "./assets";
import { modemBusy } from "./modem-activity";
import type { Core, Result } from "./wasm-bridge";
import type { FskDecodeResult, FskMode } from "./types";

export const FFT_SIZE = 1024;
/** Squelch threshold: 1.6× the noise floor in RMS (≈ 4 dB), never below −74 dBFS. */
const SQUELCH_RATIO = 1.6;
const SQUELCH_MIN_RMS = 0.0002;
/** Initial floor cap (≈ −54 dBFS, a quiet room): a loud first chunk cannot set the floor. */
const SQUELCH_INIT_MAX_RMS = 0.002;
/** Jammer 25 dB louder than the modem. (At −10 dB the Goertzel gain still decodes.) */
export const JAM_SNR_DB = -25;

export interface AcousticTick {
  /** Latest FFT_SIZE samples heard by the receiver. */
  window: Float32Array;
  cursor: number;
  total: number;
  sampleRate: number;
  syncLocked: boolean;
}

let sharedCtx: AudioContext | null = null;

/** One AudioContext per tab, created on a user gesture. */
export async function audioContext(): Promise<AudioContext> {
  sharedCtx ??= new AudioContext({ latencyHint: "interactive" });
  if (sharedCtx.state === "suspended") await sharedCtx.resume();
  return sharedCtx;
}

function tail(buf: Float32Array, end: number, size: number): Float32Array {
  const e = Math.max(0, Math.min(end, buf.length));
  return buf.subarray(Math.max(0, e - size), e);
}

function abortError(): DOMException {
  return new DOMException("Transmission cancelled", "AbortError");
}

export interface LoopbackOptions {
  mode: FskMode;
  snrDb: number;
  seed: number;
  /** Plays the noisy signal on the speakers while it is "received". */
  playAudio: boolean;
  volume?: number;
  signal?: AbortSignal;
  onTick?: (tick: AcousticTick) => void;
  /** Chimera race sabotage: once true, the rest of the burst is drowned by a jammer at JAM_SNR_DB. */
  jammed?: () => boolean;
}

export interface LoopbackOutcome {
  result: Result<FskDecodeResult>;
  sampleRate: number;
  burstSamples: number;
  /** Real time the transmission took, in ms. */
  elapsedMs: number;
  audioPlayed: boolean;
}

/**
 * Virtual speaker → air → microphone path: WASM synthesizes the burst, white
 * noise is added at `snrDb`, the signal is "received" in real time (with
 * optional playback), and the receiver demodulates what it has heard so far.
 */
export async function runAcousticLoopback(core: Core, frame: Uint8Array, opts: LoopbackOptions): Promise<LoopbackOutcome> {
  const sampleRate = 48_000;
  const modulated = core.fskModulate(frame, sampleRate, opts.mode);
  if (!modulated.ok) return { result: modulated, sampleRate, burstSamples: 0, elapsedMs: 0, audioPlayed: false };
  const pcm = modulated.value;

  const lead = Math.round(sampleRate * 0.25);
  const trail = Math.round(sampleRate * 0.15);
  const total = lead + pcm.length + trail;
  const clean = new Float32Array(total);
  clean.set(pcm, lead);
  // Noise referenced to the tone power, as in tests/noise_fsk_fuzz.rs.
  const noise = core.injectNoise(new Float32Array(total), opts.snrDb, opts.seed);
  const rx = new Float32Array(total);
  for (let i = 0; i < total; i++) rx[i] = (clean[i] ?? 0) + (noise[i] ?? 0);

  let audioPlayed = false;
  let clock: () => number;
  let stopAudio = () => {};
  if (opts.playAudio) {
    try {
      const ctx = await audioContext();
      const buffer = ctx.createBuffer(1, total, sampleRate);
      const vol = opts.volume ?? 0.35;
      const ch = buffer.getChannelData(0);
      for (let i = 0; i < total; i++) ch[i] = Math.max(-1, Math.min(1, (rx[i] ?? 0) * vol));
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const start = ctx.currentTime + 0.05;
      src.start(start);
      clock = () => Math.max(0, (ctx.currentTime - start) * sampleRate);
      stopAudio = () => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      };
      audioPlayed = true;
    } catch {
      clock = wallClock(sampleRate);
    }
  } else {
    clock = wallClock(sampleRate);
  }

  const t0 = performance.now();
  let syncLocked = false;
  let jamApplied = false;
  let lastProbe = 0;
  const probeEvery = 250;
  const preambleSamples = sampleRate * (opts.mode === "fast" ? 0.006 : 0.015) * 45;

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      stopAudio();
      reject(abortError());
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const step = () => {
      if (opts.signal?.aborted) return;
      const cursor = Math.min(total, Math.floor(clock()));
      const now = performance.now();
      if (!jamApplied && opts.jammed?.()) {
        jamApplied = true;
        const rest = rx.subarray(cursor);
        const jam = core.injectNoise(new Float32Array(rest.length), JAM_SNR_DB, opts.seed ^ 0x6a4d);
        for (let i = 0; i < rest.length; i++) rest[i] = (rest[i] ?? 0) + (jam[i] ?? 0);
        stopAudio();
      }
      if (!syncLocked && cursor > lead + preambleSamples && now - lastProbe > probeEvery) {
        lastProbe = now;
        const probe = core.fskDemodulate(rx.subarray(0, cursor), sampleRate, opts.mode);
        syncLocked = probe.ok || probe.error.code === "FSK_INCOMPLETE";
      }
      opts.onTick?.({ window: tail(rx, cursor, FFT_SIZE), cursor, total, sampleRate, syncLocked });
      if (cursor >= total) {
        opts.signal?.removeEventListener("abort", onAbort);
        resolve();
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  });

  const result = core.fskDemodulate(rx, sampleRate, opts.mode);
  return { result, sampleRate, burstSamples: pcm.length, elapsedMs: performance.now() - t0, audioPlayed };
}

function wallClock(sampleRate: number): () => number {
  const start = performance.now();
  return () => ((performance.now() - start) / 1000) * sampleRate;
}

/** Field mode emitter: plays the burst on the real speaker. */
export async function playBurst(
  core: Core,
  frame: Uint8Array,
  mode: FskMode,
  opts: { volume?: number; signal?: AbortSignal; onTick?: (tick: AcousticTick) => void } = {},
): Promise<Result<number>> {
  const ctx = await audioContext();
  // Synthesize at ≤ 48 kHz (MAX_SAMPLES is a sample count: a 96 kHz robust burst
  // would exceed it). The AudioBuffer carries its own rate; the browser resamples.
  const sampleRate = Math.min(ctx.sampleRate, 48_000);
  const modulated = core.fskModulate(frame, sampleRate, mode);
  if (!modulated.ok) return modulated;
  const pcm = modulated.value;
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  const vol = opts.volume ?? 0.9;
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] ?? 0) * vol;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  const start = ctx.currentTime + 0.1;
  src.start(start);
  // Sound effects stay silent until the burst ends or is aborted.
  const release = modemBusy();

  try {
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      reject(abortError());
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    src.onended = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const step = () => {
      if (opts.signal?.aborted) return;
      const cursor = Math.max(0, Math.floor((ctx.currentTime - start) * sampleRate));
      if (cursor < pcm.length) {
        opts.onTick?.({ window: tail(pcm, cursor, FFT_SIZE), cursor, total: pcm.length, sampleRate, syncLocked: false });
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  });
  } finally {
    release();
  }
  return { ok: true, value: pcm.length / sampleRate };
}

export type MicStatus = "listening" | "sync" | "decoded" | "error";

export interface MicCallbacks {
  onTick?: (tick: AcousticTick) => void;
  onStatus?: (status: MicStatus, detail?: string) => void;
  onFrame?: (frame: Uint8Array, info: FskDecodeResult) => void;
}

/**
 * Field mode receiver: captures the microphone into a ring buffer and runs the
 * WASM demodulator on it periodically.
 */
export class MicReceiver {
  private stream: MediaStream | null = null;
  private node: AudioNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private ring = new Float32Array(0);
  private written = 0;
  private timer: number | null = null;
  private raf: number | null = null;
  private sampleRate = 48_000;
  private lastFrameHex = "";
  /** Adaptive noise floor (RMS) and the sample index of the last loud chunk. */
  private noiseFloor = 0;
  private lastLoudAt = -Infinity;
  private decimation = 1;
  private acc = 0;
  private accCount = 0;
  private releaseModem: (() => void) | null = null;
  private generation = 0;

  constructor(
    private readonly core: Core,
    private readonly mode: FskMode,
    private readonly cb: MicCallbacks,
  ) {}

  async start(): Promise<void> {
    // Sound effects stay silent while the microphone listens.
    this.releaseModem ??= modemBusy();
    const generation = ++this.generation;
    try {
      await this.open(generation);
    } catch (e) {
      this.releaseModem?.();
      this.releaseModem = null;
      throw e;
    }
    // stop() was called while permissions or the stream were pending: close what open() started.
    if (generation !== this.generation) this.close();
  }

  private async open(generation: number): Promise<void> {
    const ctx = await audioContext();
    // Above ~50 kHz (88.2/96/192 kHz interfaces) average groups of samples down
    // to ≤ 48 kHz: the modem tops out at 3.2 kHz, and MAX_SAMPLES counts samples.
    this.decimation = ctx.sampleRate > 50_000 ? Math.ceil(ctx.sampleRate / 48_000) : 1;
    this.sampleRate = ctx.sampleRate / this.decimation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    if (generation !== this.generation) {
      // Stopped while the permission prompt was open: never leave the microphone on.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    this.source = ctx.createMediaStreamSource(this.stream);
    const seconds = this.mode === "fast" ? 14 : 38;
    this.ring = new Float32Array(Math.min(Math.ceil(seconds * this.sampleRate), this.core.limits.maxSamples));
    this.written = 0;

    const push = (chunk: Float32Array) => this.push(chunk);
    try {
      const url = assets().workletUrl;
      if (!url) throw new Error("capture worklet URL not configured");
      await ctx.audioWorklet.addModule(url);
      const worklet = new AudioWorkletNode(ctx, "capture-processor");
      worklet.port.onmessage = (e: MessageEvent<Float32Array>) => push(e.data);
      this.source.connect(worklet);
      this.node = worklet;
    } catch {
      // Older browsers: ScriptProcessorNode fallback.
      const sp = ctx.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = (e) => push(new Float32Array(e.inputBuffer.getChannelData(0)));
      const mute = ctx.createGain();
      mute.gain.value = 0;
      this.source.connect(sp);
      sp.connect(mute);
      mute.connect(ctx.destination);
      this.node = sp;
    }

    this.cb.onStatus?.("listening");
    this.timer = window.setInterval(() => this.probe(), 700);
    const draw = () => {
      this.cb.onTick?.({
        window: this.latest(FFT_SIZE),
        cursor: this.written,
        total: this.ring.length,
        sampleRate: this.sampleRate,
        syncLocked: false,
      });
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }

  private push(raw: Float32Array): void {
    const chunk = this.decimate(raw);
    const n = this.ring.length;
    if (n === 0 || chunk.length === 0) return;
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) {
      const x = chunk[i] ?? 0;
      this.ring[(this.written + i) % n] = x;
      sum += x * x;
    }
    this.written += chunk.length;
    this.updateSquelch(Math.sqrt(sum / chunk.length));
  }

  /** Box-average decimation, carrying partial groups across chunks. */
  private decimate(raw: Float32Array): Float32Array {
    const d = this.decimation;
    if (d === 1) return raw;
    const out = new Float32Array(Math.floor((this.accCount + raw.length) / d));
    let o = 0;
    for (const x of raw) {
      this.acc += x;
      if (++this.accCount === d) {
        out[o++] = this.acc / d;
        this.acc = 0;
        this.accCount = 0;
      }
    }
    return out;
  }

  /**
   * Energy squelch. The floor follows quiet chunks quickly and rises slowly, so
   * a burst cannot pull it up. A chunk ~4 dB above the floor counts as loud:
   * any burst at ≥ 6 dB SNR (the decodable range) passes.
   */
  private updateSquelch(rms: number): void {
    // Start low, so a burst present from the first chunk still counts as loud.
    if (this.noiseFloor === 0) this.noiseFloor = Math.max(SQUELCH_MIN_RMS, Math.min(rms, SQUELCH_INIT_MAX_RMS));
    else if (rms < this.noiseFloor) this.noiseFloor = Math.max(SQUELCH_MIN_RMS, 0.7 * this.noiseFloor + 0.3 * rms);
    // Slow rise: during a 38 s robust burst (~900 worklet chunks of 2048 samples)
    // the floor moves ~36 % of the way up, still well under the 1.6× threshold.
    else this.noiseFloor = 0.9995 * this.noiseFloor + 0.0005 * rms;
    if (rms > Math.max(SQUELCH_MIN_RMS, this.noiseFloor * SQUELCH_RATIO)) this.lastLoudAt = this.written;
  }

  /** True while something louder than the floor is still inside the ring buffer. */
  private hasSignal(): boolean {
    return this.written - this.lastLoudAt < this.ring.length;
  }

  /** Last `size` samples in chronological order. */
  private latest(size: number): Float32Array {
    const n = this.ring.length;
    const count = Math.min(size, this.written, n);
    const out = new Float32Array(count);
    const start = this.written - count;
    for (let i = 0; i < count; i++) out[i] = this.ring[(start + i) % n] ?? 0;
    return out;
  }

  private probe(): void {
    // Squelch: skip the demodulator (and its false FEC errors) on pure room noise.
    if (!this.hasSignal()) {
      this.cb.onStatus?.("listening");
      return;
    }
    const buf = this.latest(this.ring.length);
    const res = this.core.fskDemodulate(buf, this.sampleRate, this.mode);
    if (res.ok) {
      const frame = res.value.frame;
      let hex = "";
      for (const b of frame) hex += b.toString(16).padStart(2, "0");
      if (hex !== this.lastFrameHex) {
        this.lastFrameHex = hex;
        this.cb.onStatus?.("decoded");
        this.cb.onFrame?.(frame, res.value);
      }
      return;
    }
    if (res.error.code === "FSK_INCOMPLETE") this.cb.onStatus?.("sync");
    else if (res.error.code === "FSK_NO_PREAMBLE" || res.error.code === "FSK_TOO_SHORT") this.cb.onStatus?.("listening");
    // Anything else (FEC_UNCORRECTABLE, TOO_MANY_SAMPLES, …) is shown, never hidden as "listening".
    else this.cb.onStatus?.("error", `${res.error.code}: ${res.error.message}`);
  }

  stop(): void {
    // Invalidates a start() still waiting for the microphone.
    this.generation++;
    this.close();
  }

  private close(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.timer = null;
    this.raf = null;
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = null;
    this.source = null;
    this.stream = null;
    this.releaseModem?.();
    this.releaseModem = null;
  }
}
