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

export function inspectFrameHex(hex: string) {
  const g = core();
  const frame = hexToBytes(hex);
  const inspection = g.inspect_frame(frame);
  let verification: unknown;
  try {
    verification = { ok: true, ...g.decode_frame(frame, []) };
  } catch (e) {
    verification = { ok: false, ...errorOf(e) };
  }
  return { frameLen: frame.length, inspection, verification };
}

/** Fixed demo seed: benchmark only, never used to sign real documents. */
const BENCH_SEED = new Uint8Array(32).fill(0x42);

export function sampleFrameHex(presetId = "tontine"): string {
  const g = core();
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const enc = g.encode_document(preset.draft, BENCH_SEED, 0b1110);
  return bytesToHex(enc.frame as Uint8Array);
}

export interface BenchmarkResult {
  preset: string;
  frameLen: number;
  acoustic: { snrDb: number; iterations: number; decoded: number; successRate: number; medianDemodMs: number; burstSeconds: number };
  optical: { dropRatePct: number; iterations: number; reconstructed: number; successRate: number; avgReceived: number; avgShown: number; worstShown: number; k: number };
  encodeMs: number;
  verifyMs: number;
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
