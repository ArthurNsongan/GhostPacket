// ghostpacket-inspector: MCP server (stdio) declared in .kiro/settings/mcp.json.
// stdout carries the MCP protocol only; diagnostics go to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { checkCompliance, core, inspectFrameHex, runChannelBenchmark, runHighSpeedBenchmark, SAMPLE_PASSPHRASE, sampleFrameHex } from "./core.ts";

const server = new McpServer({ name: "ghostpacket-inspector", version: "0.3.0" });

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

server.registerTool(
  "inspect_frame_hex",
  {
    title: "Inspect a GhostPacket frame",
    description:
      "Decodes a raw GPKT frame (v1 ≤ 512 B or v2 with an image) given as hex: header fields, flags, payload size, CRC32 validity, decryption, Ed25519 verification and the decoded document (image bytes summarized). " +
      `Pass sample to get a freshly signed demo frame instead; the "encrypted" sample opens with passphrase "${SAMPLE_PASSPHRASE}".`,
    inputSchema: {
      hex: z.string().optional().describe("Frame bytes in hex (spaces allowed)."),
      sample: z.enum(["tontine", "prescription", "voucher", "encrypted", "image"]).optional().describe("Return and inspect a freshly signed demo frame."),
      passphrase: z.string().max(128).optional().describe("Opens an end-to-end encrypted frame (FLAG_ENCRYPTED)."),
    },
  },
  async ({ hex, sample, passphrase }) => {
    const frameHex = hex ?? (sample ? sampleFrameHex(sample) : undefined);
    if (!frameHex) return json({ error: "Provide `hex` or `sample`." });
    return json({ hex: frameHex.length > 4096 ? `${frameHex.slice(0, 4096)}…` : frameHex, ...inspectFrameHex(frameHex, passphrase) });
  },
);

server.registerTool(
  "run_channel_benchmark",
  {
    title: "Benchmark the acoustic and optical channels",
    description:
      "Runs the GhostPacket WASM core under deterministic impairments. V1 frames: white noise at snr_db on the 4-FSK channel and drop_rate_pct lost QR frames on the fountain channel. " +
      "With image_kb > 0, also a GPKT v2 image frame over the OFDM chord (noise at snr_db) and over ChromaCrypt color matrices (drop_rate_pct lost), plus an Ultrasonic Whisper identity card (17.6–19.6 kHz) at snr_db. Returns success rates, throughput and latencies.",
    inputSchema: {
      snr_db: z.number().min(-10).max(60).default(10),
      drop_rate_pct: z.number().min(0).max(90).default(30),
      iterations: z.number().int().min(1).max(200).default(20),
      preset: z.enum(["tontine", "prescription", "voucher"]).default("tontine"),
      image_kb: z.number().min(0).max(64).default(0).describe("Size of the synthetic image for the V3 transports; 0 skips them."),
    },
  },
  async ({ snr_db, drop_rate_pct, iterations, preset, image_kb }) => {
    const v1 = runChannelBenchmark(snr_db, drop_rate_pct, iterations, preset);
    if (!image_kb) return json(v1);
    return json({ ...v1, highSpeed: runHighSpeedBenchmark(image_kb, Math.max(snr_db, 12), drop_rate_pct, Math.min(iterations, 10)) });
  },
);

server.registerTool(
  "check_kiroween_compliance",
  {
    title: "Kiroween compliance audit",
    description:
      "Audits the repository: .kiro/ tracked by git, no external AI tool files, MIT license, no client secret, zero panic in Rust src, Skeleton Crew (apps only use the shared packages), WASM size. full=true also runs the Rust suites, the SDK tests and the TypeScript typecheck.",
    inputSchema: {
      full: z.boolean().default(false),
    },
  },
  async ({ full }) => json(checkCompliance(full)),
);

core();
await server.connect(new StdioServerTransport());
console.error(`ghostpacket-inspector ready (core ${core().core_version()})`);
