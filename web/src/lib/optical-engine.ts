// Optical channel I/O: draws fountain droplets as QR codes and reads them back
// (jsQR on a canvas in loopback, BarcodeDetector or jsQR on the camera).
// Fountain coding itself runs in WASM.
import qrcode from "qrcode-generator";
import jsQR from "jsqr";

import { fromHex, toHex, type Core, type FountainReceiver, type Result } from "./wasm-bridge";
import type { DropletStep, GhostError } from "./types";

export const QR_DARK = "#04150c";
export const QR_LIGHT = "#e9fff3";

/** Session id shared by every droplet of a frame. */
export function sessionFor(core: Core, frame: Uint8Array): number {
  return core.crc32(frame) & 0xffff;
}

/** Renders `text` (uppercase hex = QR alphanumeric mode) on `canvas`. */
export function drawQr(canvas: HTMLCanvasElement, text: string, moduleSize = 4, margin = 4): number {
  const qr = qrcode(0, "M");
  qr.addData(text, "Alphanumeric");
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * moduleSize;
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return n;
  ctx.fillStyle = QR_LIGHT;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = QR_DARK;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * moduleSize, (r + margin) * moduleSize, moduleSize, moduleSize);
    }
  }
  return n;
}

/** Reads a QR code from the pixels of `canvas` (the "camera" in loopback). */
export function readQrFromCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
  return code?.data ?? null;
}

export interface OpticalTick {
  index: number;
  qrText: string;
  modules: number;
  dropped: boolean;
  /** QR was shown and kept, but the reader could not decode it. */
  unreadable: boolean;
  step?: DropletStep;
  error?: GhostError;
}

export interface OpticalOptions {
  fps: number;
  dropPct: number;
  seed: number;
  canvas: HTMLCanvasElement;
  signal?: AbortSignal;
  onTick?: (tick: OpticalTick) => void;
}

export interface OpticalOutcome {
  result: Result<Uint8Array>;
  k: number;
  shown: number;
  received: number;
  elapsedMs: number;
}

/**
 * Virtual screen → camera path: each droplet is drawn as a QR code, a
 * deterministic share of frames is lost, and the survivors are decoded from
 * the canvas pixels with jsQR before reaching the WASM fountain decoder.
 */
export async function runOpticalLoopback(core: Core, frame: Uint8Array, opts: OpticalOptions): Promise<OpticalOutcome> {
  const t0 = performance.now();
  const txRes = core.fountainTx(frame, sessionFor(core, frame));
  if (!txRes.ok) return { result: txRes, k: 0, shown: 0, received: 0, elapsedMs: 0 };
  const tx = txRes.value;
  const k = tx.k();
  const rx = core.fountainRx();
  const start = (opts.seed * 7) >>> 0;
  const maxFrames = k * 10;
  const interval = 1000 / opts.fps;
  let received = 0;

  try {
    for (let i = 0; i < maxFrames; i++) {
      if (opts.signal?.aborted) throw new DOMException("Transmission cancelled", "AbortError");
      const tickStart = performance.now();
      const droplet = tx.droplet((start + i) >>> 0);
      const qrText = toHex(droplet);
      const modules = drawQr(opts.canvas, qrText);
      const dropped = core.isDropped(opts.seed, i, opts.dropPct);
      const tick: OpticalTick = { index: i, qrText, modules, dropped, unreadable: false };
      if (!dropped) {
        const read = readQrFromCanvas(opts.canvas);
        const bytes = read ? fromHex(read) : null;
        if (!bytes) {
          tick.unreadable = true;
        } else {
          received++;
          const step = rx.ingest(bytes);
          if (step.ok) tick.step = step.value;
          else tick.error = step.error;
        }
      }
      opts.onTick?.(tick);
      if (tick.step?.complete) {
        return { result: rx.frame(), k, shown: i + 1, received, elapsedMs: performance.now() - t0 };
      }
      const wait = interval - (performance.now() - tickStart);
      await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    }
    return {
      result: { ok: false, error: { code: "FOUNTAIN_INCOMPLETE", message: `Frame not rebuilt after ${maxFrames} QR codes` } },
      k,
      shown: maxFrames,
      received,
      elapsedMs: performance.now() - t0,
    };
  } finally {
    rx.free();
    tx.free();
  }
}

/** Field mode emitter: loops droplets on `canvas` until aborted. */
export async function broadcast(
  core: Core,
  frame: Uint8Array,
  canvas: HTMLCanvasElement,
  fps: number,
  signal: AbortSignal,
  onFrame?: (index: number, k: number) => void,
): Promise<void> {
  const txRes = core.fountainTx(frame, sessionFor(core, frame));
  if (!txRes.ok) throw new Error(txRes.error.message);
  const tx = txRes.value;
  const k = tx.k();
  try {
    for (let i = 0; !signal.aborted; i++) {
      drawQr(canvas, toHex(tx.droplet(i >>> 0)), 8);
      onFrame?.(i, k);
      await new Promise((r) => setTimeout(r, 1000 / fps));
    }
  } finally {
    tx.free();
  }
}

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

/** Field mode receiver: camera → QR text → WASM fountain decoder. */
export class CameraScanner {
  private stream: MediaStream | null = null;
  private raf: number | null = null;
  private detector: BarcodeDetectorLike | null = null;
  private scratch: HTMLCanvasElement | null = null;
  private busy = false;
  readonly engine: "BarcodeDetector" | "jsQR";

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly rx: FountainReceiver,
    private readonly onStep: (step: Result<DropletStep>, text: string) => void,
  ) {
    const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (Ctor) {
      try {
        this.detector = new Ctor({ formats: ["qr_code"] });
      } catch {
        this.detector = null;
      }
    }
    this.engine = this.detector ? "BarcodeDetector" : "jsQR";
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    const loop = () => {
      void this.scan();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private async scan(): Promise<void> {
    if (this.busy || this.video.readyState < 2) return;
    this.busy = true;
    try {
      let text: string | null = null;
      if (this.detector) {
        const codes = await this.detector.detect(this.video);
        text = codes[0]?.rawValue ?? null;
      } else {
        this.scratch ??= document.createElement("canvas");
        const w = 480;
        const h = Math.round((this.video.videoHeight / Math.max(1, this.video.videoWidth)) * w) || 270;
        this.scratch.width = w;
        this.scratch.height = h;
        const ctx = this.scratch.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(this.video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          text = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
        }
      }
      const bytes = text ? fromHex(text) : null;
      if (text && bytes) this.onStep(this.rx.ingest(bytes), text);
    } catch {
      /* transient detector error: try next frame */
    } finally {
      this.busy = false;
    }
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
