// Loads the exact WASM binary shipped to the browser and wraps the checks
// used by the MCP tools. Kept separate from index.ts so it can be smoke-tested.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import * as gp from "../../packages/ghostpacket-sdk/wasm/ghostpacket_core.js";
import { PRESETS } from "../../packages/ghostpacket-sdk/src/presets.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let ready = false;
export function core(): typeof gp {
  if (!ready) {
    const wasm = readFileSync(join(repoRoot, "packages", "ghostpacket-sdk", "wasm", "ghostpacket_core_bg.wasm"));
    gp.initSync({ module: wasm });
    ready = true;
  }
  return gp;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2 !== 0) throw new Error("hex string has an odd number of digits");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function errorOf(e: unknown): { code: string; message: string } {
  if (e && typeof e === "object" && "code" in e && "message" in e) {
    return { code: String((e as { code: unknown }).code), message: String((e as { message: unknown }).message) };
  }
  return { code: "UNKNOWN", message: String(e) };
}

/** Image bytes are summarized: a 16 KB array would flood the agent's context. */
function summarize(value: unknown): unknown {
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  if (Array.isArray(value)) return value.map(summarize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, summarize(v)]));
  return value;
}

export function inspectFrameHex(hex: string, passphrase?: string) {
  const g = core();
  const frame = hexToBytes(hex);
  const pass = passphrase ? passphrase.normalize("NFC") : undefined;
  const inspection = g.inspect_frame(frame, pass);
  let verification: unknown;
  try {
    verification = { ok: true, ...(summarize(g.decode_frame(frame, [], pass)) as object) };
  } catch (e) {
    verification = { ok: false, ...errorOf(e) };
  }
  return { frameLen: frame.length, version: frame[4] ?? null, inspection, verification };
}

/** Fixed demo seed: benchmark only, never used to sign real documents. */
const BENCH_SEED = new Uint8Array(32).fill(0x42);
/** Passphrase of the "encrypted" sample (demo only). */
export const SAMPLE_PASSPHRASE = "baobab moon harmattan";

/** A well-formed but synthetic WebP container (deterministic bytes). */
function syntheticWebp(len: number): Uint8Array {
  const v = new Uint8Array(len);
  v.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(v.buffer).setUint32(4, len - 8, true);
  v.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20], 8);
  let x = 0x12345678;
  for (let i = 16; i < len; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    v[i] = x & 0xff;
  }
  return v;
}

function imageDraft(bytes: number) {
  return {
    docId: Array.from("IMG-0815", (c) => c.charCodeAt(0)),
    timestamp: 1_793_448_000,
    body: {
      imageDocument: {
        title: "Malaria RDT",
        subjectRef: "PAT-0815 (F, 34 y)",
        caption: "Synthetic benchmark image",
        relatedDocId: Array.from("RX-77310", (c) => c.charCodeAt(0)),
        mime: 1,
        width: 640,
        height: 360,
        image: syntheticWebp(bytes),
      },
    },
  };
}

export type Sample = "tontine" | "prescription" | "voucher" | "encrypted" | "image";

export function sampleFrame(sample: Sample = "tontine", imageBytes = 16 * 1024): Uint8Array {
  const g = core();
  if (sample === "image") return g.encode_document_v2(imageDraft(imageBytes), BENCH_SEED, 0b0100).frame as Uint8Array;
  const presetId = sample === "encrypted" ? "prescription" : sample;
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  if (sample === "encrypted") {
    return g.encode_document(preset.draft, BENCH_SEED, 0b0110, SAMPLE_PASSPHRASE, new Uint8Array(16).fill(7)).frame as Uint8Array;
  }
  return g.encode_document(preset.draft, BENCH_SEED, 0b1110).frame as Uint8Array;
}

export function sampleFrameHex(sample: Sample = "tontine"): string {
  return bytesToHex(sampleFrame(sample, 2048));
}
export interface BenchmarkResult {
  preset: string;
  frameLen: number;
  acoustic: { snrDb: number; iterations: number; decoded: number; successRate: number; medianDemodMs: number; burstSeconds: number };
  optical: { dropRatePct: number; iterations: number; reconstructed: number; successRate: number; avgReceived: number; avgShown: number; worstShown: number; k: number };
  encodeMs: number;
  verifyMs: number;
}

export interface HighSpeedResult {
  imageBytes: number;
  frameLen: number;
  ofdm: { snrDb: number; iterations: number; decoded: number; successRate: number; burstSeconds: number; kbps: number; medianDemodMs: number; meanCorrectedBytes: number } | { skipped: string };
  chroma: {
    dropRatePct: number;
    iterations: number;
    reconstructed: number;
    successRate: number;
    k: number;
    avgShown: number;
    avgReceived: number;
    secondsAt15Fps: number;
    kbpsAt15Fps: number;
    medianScanMs: number;
  };
  /** Ultrasonic Whisper (17.6–19.6 kHz FSK) on a signed identity card, same SNR. */
  ultrasonic: { frameLen: number; snrDb: number; iterations: number; decoded: number; successRate: number; burstSeconds: number; bps: number };
}

const QUIET = 3;
const CELL_PX = 6;

/** Renders ChromaCrypt cells to RGBA exactly as the browser canvas does (palette from the core). */
function renderChroma(cells: Uint8Array, grid: number, palette: Uint8Array): { rgba: Uint8Array; side: number } {
  const side = (grid + 2 * QUIET) * CELL_PX;
  const rgba = new Uint8Array(side * side * 4).fill(255);
  for (let i = 0; i < grid * grid; i++) {
    const v = cells[i] ?? 0;
    const r0 = (QUIET + Math.floor(i / grid)) * CELL_PX;
    const c0 = (QUIET + (i % grid)) * CELL_PX;
    for (let y = 0; y < CELL_PX; y++) {
      for (let x = 0; x < CELL_PX; x++) {
        const p = ((r0 + y) * side + c0 + x) * 4;
        rgba[p] = palette[v * 3] ?? 0;
        rgba[p + 1] = palette[v * 3 + 1] ?? 0;
        rgba[p + 2] = palette[v * 3 + 2] ?? 0;
      }
    }
  }
  return { rgba, side };
}

/** GPKT v2 image frames over the OFDM chord (white noise) and ChromaCrypt (lost matrices). */
export function runHighSpeedBenchmark(imageKb: number, snrDb: number, dropRatePct: number, iterations: number): HighSpeedResult {
  const g = core();
  const frame = sampleFrame("image", Math.round(imageKb * 1024));
  const limits = g.limits() as { ofdmMaxFrame: number; chromaGrid: number };
  const sampleRate = 48_000;

  let ofdm: HighSpeedResult["ofdm"];
  if (frame.length > limits.ofdmMaxFrame) {
    ofdm = { skipped: `frame ${frame.length} B > OFDM limit ${limits.ofdmMaxFrame} B` };
  } else {
    const pcm = g.ofdm_modulate(frame, sampleRate);
    const lead = new Float32Array(pcm.length + 9600);
    lead.set(pcm, 4800);
    let decoded = 0;
    let corrected = 0;
    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const noisy = g.inject_awgn(lead, snrDb, 2000 + i);
      const t0 = performance.now();
      try {
        const r = g.ofdm_demodulate(noisy, sampleRate);
        g.decode_frame(r.frame as Uint8Array, []);
        decoded++;
        corrected += r.correctedBytes as number;
      } catch {
        /* failure */
      }
      times.push(performance.now() - t0);
    }
    const secs = g.ofdm_burst_seconds(frame.length, sampleRate);
    ofdm = {
      snrDb,
      iterations,
      decoded,
      successRate: decoded / iterations,
      burstSeconds: Number(secs.toFixed(2)),
      kbps: Number(((frame.length * 8) / secs / 1000).toFixed(2)),
      medianDemodMs: Number(median(times).toFixed(1)),
      meanCorrectedBytes: Number((decoded ? corrected / decoded : 0).toFixed(1)),
    };
  }

  const palette = g.chroma_palette() as Uint8Array;
  const tx = new g.ChromaTx(frame, 0x4348);
  const k = tx.k();
  let reconstructed = 0;
  const shown: number[] = [];
  const received: number[] = [];
  const scanTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const rx = new g.ChromaRx();
    let got = 0;
    for (let n = 0; n < k * 4; n++) {
      if (g.is_dropped(100 + i, n, dropRatePct)) continue;
      const { rgba, side } = renderChroma(tx.cells(i * 1000 + n), limits.chromaGrid, palette);
      const t0 = performance.now();
      const scan = rx.scan(rgba, side, side) as { found: boolean; step?: { complete: boolean } | null };
      scanTimes.push(performance.now() - t0);
      if (!scan.step) continue;
      got++;
      if (scan.step.complete) {
        g.decode_frame(rx.frame(), []);
        reconstructed++;
        shown.push(n + 1);
        received.push(got);
        break;
      }
    }
    rx.free();
  }
  tx.free();
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const secs15 = avg(shown) / 15;
  return {
    imageBytes: Math.round(imageKb * 1024),
    frameLen: frame.length,
    ofdm,
    chroma: {
      dropRatePct,
      iterations,
      reconstructed,
      successRate: reconstructed / iterations,
      k,
      avgShown: Number(avg(shown).toFixed(1)),
      avgReceived: Number(avg(received).toFixed(1)),
      secondsAt15Fps: Number(secs15.toFixed(2)),
      kbpsAt15Fps: Number((secs15 ? (frame.length * 8) / secs15 / 1000 : 0).toFixed(1)),
      medianScanMs: Number(median(scanTimes).toFixed(2)),
    },
    ultrasonic: ultrasonicBench(snrDb, iterations),
  };
}

function ultrasonicBench(snrDb: number, iterations: number): HighSpeedResult["ultrasonic"] {
  const g = core();
  const card = g.encode_document(
    { docId: Array.from("KEY-0815", (c) => c.charCodeAt(0)), timestamp: 1_793_448_000, body: { customMessage: { sender: "Ndiob health post", title: "Identity card", message: "" } } },
    BENCH_SEED,
    0b0010,
  ).frame as Uint8Array;
  const pcm = g.fsk_modulate(card, 48_000, 2);
  const padded = new Float32Array(pcm.length + 9600);
  padded.set(pcm, 4800);
  let decoded = 0;
  for (let i = 0; i < iterations; i++) {
    try {
      const r = g.fsk_demodulate(g.inject_awgn(padded, snrDb, 3000 + i), 48_000, 2);
      g.decode_frame(r.frame as Uint8Array, []);
      decoded++;
    } catch {
      /* failure */
    }
  }
  const secs = g.fsk_burst_seconds(card.length, 2);
  return { frameLen: card.length, snrDb, iterations, decoded, successRate: decoded / iterations, burstSeconds: Number(secs.toFixed(2)), bps: Math.round((card.length * 8) / secs) };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function runChannelBenchmark(snrDb: number, dropRatePct: number, iterations: number, presetId = "tontine"): BenchmarkResult {
  const g = core();
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];

  let t = performance.now();
  const enc = g.encode_document(preset.draft, BENCH_SEED, 0b1110);
  const encodeMs = performance.now() - t;
  const frame = enc.frame as Uint8Array;
  t = performance.now();
  g.decode_frame(frame, []);
  const verifyMs = performance.now() - t;

  const sampleRate = 48_000;
  const pcm = g.fsk_modulate(frame, sampleRate, 1);
  let decoded = 0;
  const demodTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const noisy = g.inject_awgn(pcm, snrDb, 1000 + i);
    const t0 = performance.now();
    try {
      const res = g.fsk_demodulate(noisy, sampleRate, 1);
      g.decode_frame(res.frame as Uint8Array, []);
      decoded++;
    } catch {
      /* counted as failure */
    }
    demodTimes.push(performance.now() - t0);
  }

  const tx = new g.FountainTx(frame, 0x6770, 16);
  const k = tx.k();
  let reconstructed = 0;
  const received: number[] = [];
  const shown: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const rx = new g.FountainRx();
    const start = i * 7;
    let got = 0;
    for (let n = 0; n < k * 8; n++) {
      if (g.is_dropped(i, n, dropRatePct)) continue;
      got++;
      const step = rx.ingest(tx.droplet(start + n));
      if (step.complete) {
        g.decode_frame(rx.frame(), []);
        reconstructed++;
        received.push(got);
        shown.push(n + 1);
        break;
      }
    }
    rx.free();
  }
  tx.free();

  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  return {
    preset: preset.id,
    frameLen: frame.length,
    acoustic: {
      snrDb,
      iterations,
      decoded,
      successRate: decoded / iterations,
      medianDemodMs: Number(median(demodTimes).toFixed(2)),
      burstSeconds: Number(g.fsk_burst_seconds(frame.length, 1).toFixed(2)),
    },
    optical: {
      dropRatePct,
      iterations,
      reconstructed,
      successRate: reconstructed / iterations,
      avgReceived: Number(avg(received).toFixed(1)),
      avgShown: Number(avg(shown).toFixed(1)),
      worstShown: shown.length ? Math.max(...shown) : 0,
      k,
    },
    encodeMs: Number(encodeMs.toFixed(3)),
    verifyMs: Number(verifyMs.toFixed(3)),
  };
}

export function checkCompliance(full: boolean) {
  const args = [join(repoRoot, "scripts", "kiroween-audit.mjs"), "--json"];
  if (full) args.push("--full");
  const r = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8" });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { ok: false, checks: [{ name: "audit script", ok: false, detail: (r.stderr || r.stdout || "").slice(-2000) }] };
  }
}
