// Smoke test: `npm --prefix mcp-server run smoke`. Exercises the same code
// paths as the MCP tools without a client.
import { checkCompliance, inspectFrameHex, runChannelBenchmark, sampleFrameHex } from "./core.ts";

const hex = sampleFrameHex("tontine");
const good = inspectFrameHex(hex);
console.log("valid frame:", JSON.stringify(good.verification).slice(0, 160), "…");

const tampered = hex.slice(0, 40) + (hex[40] === "0" ? "1" : "0") + hex.slice(41);
const bad = inspectFrameHex(tampered);
console.log("tampered frame:", JSON.stringify(bad.verification));

const bench = runChannelBenchmark(10, 30, 10);
console.log("benchmark:", JSON.stringify(bench));

const audit = checkCompliance(false);
console.log("audit ok:", audit.ok);

const failed = !(good.verification as { ok: boolean }).ok || (bad.verification as { ok: boolean }).ok || bench.acoustic.successRate < 1 || bench.optical.successRate < 1;
process.exit(failed ? 1 : 0);
