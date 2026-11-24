// ghostpacket-inspector: MCP server (stdio) declared in .kiro/settings/mcp.json.
// stdout carries the MCP protocol only; diagnostics go to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { checkCompliance, core, inspectFrameHex, runChannelBenchmark, sampleFrameHex } from "./core.ts";

const server = new McpServer({ name: "ghostpacket-inspector", version: "0.1.0" });

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

server.registerTool(
  "inspect_frame_hex",
  {
    title: "Inspect a GhostPacket frame",
    description:
      "Decodes a raw GPKT frame given as hex: header fields, flags, payload size, CRC32 validity, Ed25519 verification and the decoded document. Pass sample=true to get a valid demo frame instead.",
    inputSchema: {
      hex: z.string().optional().describe("Frame bytes in hex (spaces allowed)."),
      sample: z.enum(["tontine", "prescription", "voucher"]).optional().describe("Return and inspect a freshly signed demo frame."),
    },
  },
  async ({ hex, sample }) => {
    const frameHex = hex ?? (sample ? sampleFrameHex(sample) : undefined);
    if (!frameHex) return json({ error: "Provide `hex` or `sample`." });
    return json({ hex: frameHex, ...inspectFrameHex(frameHex) });
  },
);

server.registerTool(
  "run_channel_benchmark",
  {
    title: "Benchmark the acoustic and optical channels",
    description:
      "Runs the GhostPacket WASM core under deterministic impairments: white noise at snr_db on the 4-FSK channel and drop_rate_pct lost QR frames on the fountain channel. Returns success rates and latencies.",
    inputSchema: {
      snr_db: z.number().min(-10).max(60).default(10),
      drop_rate_pct: z.number().min(0).max(90).default(30),
      iterations: z.number().int().min(1).max(200).default(20),
      preset: z.enum(["tontine", "prescription", "voucher"]).default("tontine"),
    },
  },
  async ({ snr_db, drop_rate_pct, iterations, preset }) => json(runChannelBenchmark(snr_db, drop_rate_pct, iterations, preset)),
);

server.registerTool(
  "check_kiroween_compliance",
  {
    title: "Kiroween compliance audit",
    description:
      "Audits the repository: .kiro/ tracked by git, no external AI tool files, MIT license, no client secret, zero panic in Rust src, WASM size. full=true also runs the Rust suite and the TypeScript typecheck.",
    inputSchema: {
      full: z.boolean().default(false),
    },
  },
  async ({ full }) => json(checkCompliance(full)),
);

core();
await server.connect(new StdioServerTransport());
console.error(`ghostpacket-inspector ready (core ${core().core_version()})`);
