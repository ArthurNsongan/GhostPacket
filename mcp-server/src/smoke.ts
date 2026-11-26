// Smoke test: `npm --prefix mcp-server run smoke`. Exercises the same code
// paths as the MCP tools without a client.
import { checkCompliance, inspectFrameHex, runChannelBenchmark, runHighSpeedBenchmark, SAMPLE_PASSPHRASE, sampleFrameHex } from "./core.ts";

const hex = sampleFrameHex("tontine");
const good = inspectFrameHex(hex);
console.log("valid frame:", JSON.stringify(good.verification).slice(0, 160), "…");

const tampered = hex.slice(0, 40) + (hex[40] === "0" ? "1" : "0") + hex.slice(41);
const bad = inspectFrameHex(tampered);
console.log("tampered frame:", JSON.stringify(bad.verification));

const enc = sampleFrameHex("encrypted");
const locked = inspectFrameHex(enc);
const opened = inspectFrameHex(enc, SAMPLE_PASSPHRASE);
console.log("encrypted frame:", (locked.verification as { code?: string }).code, "→ with passphrase:", (opened.verification as { ok: boolean }).ok);

const img = inspectFrameHex(sampleFrameHex("image"));
console.log("image frame (v2):", img.version, JSON.stringify(img.verification).slice(0, 220), "…");

const bench = runChannelBenchmark(10, 30, 10);
console.log("benchmark:", JSON.stringify(bench));

const fast = runHighSpeedBenchmark(12, 15, 30, 4);
console.log("high-speed:", JSON.stringify(fast));

const audit = checkCompliance(false);
console.log("audit ok:", audit.ok);

const ofdmOk = "successRate" in fast.ofdm && fast.ofdm.successRate === 1;
const failed =
  !(good.verification as { ok: boolean }).ok ||
  (bad.verification as { ok: boolean }).ok ||
  (locked.verification as { code?: string }).code !== "PASSPHRASE_REQUIRED" ||
  !(opened.verification as { ok: boolean }).ok ||
  img.version !== 2 ||
  !(img.verification as { ok: boolean }).ok ||
  bench.acoustic.successRate < 1 ||
  bench.optical.successRate < 1 ||
  !ofdmOk ||
  fast.chroma.successRate < 1;
process.exit(failed ? 1 : 0);
