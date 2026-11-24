// Acoustic channel I/O. All DSP (modulation, noise, demodulation, FFT) runs in
// WASM through wasm-bridge; this module only moves samples around.
import type { Core, Result } from "./wasm-bridge";
import type { FskDecodeResult, FskMode } from "./types";

export const FFT_SIZE = 1024;

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
  const sampleRate = ctx.sampleRate;
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

  constructor(
    private readonly core: Core,
    private readonly mode: FskMode,
    private readonly cb: MicCallbacks,
  ) {}

  async start(): Promise<void> {
    const ctx = await audioContext();
    this.sampleRate = ctx.sampleRate;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.source = ctx.createMediaStreamSource(this.stream);
    const seconds = this.mode === "fast" ? 14 : 38;
    this.ring = new Float32Array(Math.ceil(seconds * this.sampleRate));
    this.written = 0;

    const push = (chunk: Float32Array) => this.push(chunk);
    try {
      await ctx.audioWorklet.addModule(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/worklets/capture-processor.js`);
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

  private push(chunk: Float32Array): void {
    const n = this.ring.length;
    if (n === 0) return;
    for (let i = 0; i < chunk.length; i++) this.ring[(this.written + i) % n] = chunk[i] ?? 0;
    this.written += chunk.length;
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
    else if (res.error.code === "FEC_UNCORRECTABLE") this.cb.onStatus?.("error", res.error.message);
    else this.cb.onStatus?.("listening");
  }

  stop(): void {
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
  }
}
