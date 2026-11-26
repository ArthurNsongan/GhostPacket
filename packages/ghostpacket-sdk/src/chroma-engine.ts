// ChromaCrypt optical I/O: draws color matrices on a canvas and reads them back
// from a camera (or from the canvas itself in the virtual loopback). Locating,
// color calibration, Reed-Solomon and the wide fountain all run in WASM.
import type { ChromaScan, WideStep } from "./types";
import type { ChromaReceiver, Core, Result } from "./wasm-bridge";

/** Quiet zone around the matrix, in cells. */
const QUIET = 3;

export function sessionFor(core: Core, frame: Uint8Array): number {
  return (core.crc32(frame) >>> 16) & 0xffff;
}

/** Draws `cells` (GRID² palette indices) with a white quiet zone; returns pixels per cell. */
export function drawChroma(canvas: HTMLCanvasElement, cells: Uint8Array, grid: number, palette: Uint8Array): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const side = Math.min(canvas.width, canvas.height);
  const px = Math.max(1, Math.floor(side / (grid + 2 * QUIET)));
  const offset = Math.floor((side - px * (grid + 2 * QUIET)) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const colors = Array.from({ length: 8 }, (_, i) => `rgb(${palette[i * 3] ?? 0},${palette[i * 3 + 1] ?? 0},${palette[i * 3 + 2] ?? 0})`);
  for (let r = 0; r < grid; r++) {
    for (let c = 0; c < grid; c++) {
      const v = cells[r * grid + c] ?? 0;
      if (v === 7) continue; // white background already
      ctx.fillStyle = colors[v] ?? "#000";
      ctx.fillRect(offset + (QUIET + c) * px, offset + (QUIET + r) * px, px, px);
    }
  }
  return px;
}

export interface ChromaTick {
  index: number;
  dropped: boolean;
  scan?: ChromaScan;
  step?: WideStep;
  /** Bytes known so far, for progressive reveal. */
  partial?: Uint8Array;
}

export interface ChromaOutcome {
  result: Result<Uint8Array>;
  k: number;
  shown: number;
  received: number;
  elapsedMs: number;
  /** Payload throughput achieved, in kbit/s. */
  kbps: number;
}

/**
 * Virtual screen → camera path: each droplet is drawn as a color matrix, a
 * deterministic share of matrices is lost, and survivors are decoded from the
 * canvas pixels by the WASM reader (finder search, calibration, RS, fountain).
 */
export async function runChromaLoopback(
  core: Core,
  frame: Uint8Array,
  opts: { canvas: HTMLCanvasElement; fps: number; dropPct: number; seed: number; signal?: AbortSignal; onTick?: (t: ChromaTick) => void },
): Promise<ChromaOutcome> {
  const t0 = performance.now();
  const txRes = core.chromaTx(frame, sessionFor(core, frame));
  if (!txRes.ok) return { result: txRes, k: 0, shown: 0, received: 0, elapsedMs: 0, kbps: 0 };
  const tx = txRes.value;
  const k = tx.k();
  const rx = core.chromaRx();
  const palette = core.chromaPalette();
  const grid = core.limits.chromaGrid;
  const ctx = opts.canvas.getContext("2d", { willReadFrequently: true });
  const interval = 1000 / opts.fps;
  let received = 0;
  try {
    for (let i = 0; i < k * 6; i++) {
      if (opts.signal?.aborted) throw new DOMException("Transmission cancelled", "AbortError");
      const tickStart = performance.now();
      drawChroma(opts.canvas, tx.cells(i >>> 0), grid, palette);
      const dropped = core.isDropped(opts.seed, i, opts.dropPct);
      const tick: ChromaTick = { index: i, dropped };
      if (!dropped && ctx) {
        const img = ctx.getImageData(0, 0, opts.canvas.width, opts.canvas.height);
        const scan = rx.scan(img.data, img.width, img.height);
        if (scan.ok) {
          tick.scan = scan.value;
          if (scan.value.step) {
            received++;
            tick.step = scan.value.step;
            tick.partial = rx.partial();
          }
        }
      }
      opts.onTick?.(tick);
      if (tick.step?.complete) {
        const elapsedMs = performance.now() - t0;
        return { result: rx.frame(), k, shown: i + 1, received, elapsedMs, kbps: (frame.length * 8) / elapsedMs };
      }
      const wait = interval - (performance.now() - tickStart);
      await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    }
    return { result: { ok: false, error: { code: "FOUNTAIN_INCOMPLETE", message: `Frame not rebuilt after ${k * 6} matrices` } }, k, shown: k * 6, received, elapsedMs: performance.now() - t0, kbps: 0 };
  } finally {
    rx.free();
    tx.free();
  }
}

/** Field emitter: loops color matrices on `canvas` until aborted. */
export async function chromaBroadcast(core: Core, frame: Uint8Array, canvas: HTMLCanvasElement, fps: number, signal: AbortSignal, onFrame?: (index: number, k: number) => void): Promise<void> {
  const txRes = core.chromaTx(frame, sessionFor(core, frame));
  if (!txRes.ok) throw new Error(txRes.error.message);
  const tx = txRes.value;
  const k = tx.k();
  const palette = core.chromaPalette();
  const grid = core.limits.chromaGrid;
  try {
    for (let i = 0; !signal.aborted; i++) {
      drawChroma(canvas, tx.cells(i >>> 0), grid, palette);
      onFrame?.(i, k);
      await new Promise((r) => setTimeout(r, 1000 / fps));
    }
  } finally {
    tx.free();
  }
}

/** Field receiver: rear camera → color matrix reader → wide fountain. */
export class ChromaScanner {
  private stream: MediaStream | null = null;
  private raf: number | null = null;
  private scratch: HTMLCanvasElement | null = null;
  private busy = false;
  private stopped = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly rx: ChromaReceiver,
    private readonly onScan: (scan: ChromaScan, partial: Uint8Array | null) => void,
    /** Analysis width: camera frames are downscaled to it (cost and noise). */
    private readonly analysisWidth = 960,
    /** Copy the partial frame (up to 128 KB) after each new droplet: only for progressive reveal. */
    private readonly withPartial = false,
  ) {}

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    const loop = () => {
      this.scan();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private scan(): void {
    if (this.busy || this.video.readyState < 2 || !this.video.videoWidth) return;
    this.busy = true;
    try {
      const scale = Math.min(1, this.analysisWidth / this.video.videoWidth);
      const w = Math.round(this.video.videoWidth * scale);
      const h = Math.round(this.video.videoHeight * scale);
      this.scratch ??= document.createElement("canvas");
      if (this.scratch.width !== w) this.scratch.width = w;
      if (this.scratch.height !== h) this.scratch.height = h;
      const ctx = this.scratch.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(this.video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const res = this.rx.scan(img.data, w, h);
      if (res.ok) this.onScan(res.value, this.withPartial && res.value.step ? this.rx.partial() : null);
    } finally {
      this.busy = false;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
