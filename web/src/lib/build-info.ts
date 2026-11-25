// Static facts shown in the Kiro Telemetry drawer and on the home page.
// Update `rustTests` and `wasmGzipKb` when a crate changes
// (`cargo test --release` on ghostpacket-core (52) and ghostpacket-verifier (12),
// and the `copy-wasm` line of `npm run wasm`).
export const BUILD_INFO = {
  coreVersion: "0.2.0",
  rustTests: 64,
  wasmGzipKb: 252,
  steering: ["product", "tech", "structure", "wasm-determinism", "ui-design-system"],
  specs: ["core-system", "binary-protocol", "acoustic-fsk", "optical-fountain", "judge-demo-ui", "platform-v2", "sdk-and-sync"],
  hooks: ["fuzz-noise-channel", "wasm-no-panic-guard", "ts-typecheck-on-save", "kiroween-audit"],
  agents: ["dsp-security-auditor"],
  mcpTools: ["inspect_frame_hex", "run_channel_benchmark", "check_kiroween_compliance"],
  repository: "https://github.com/ArthurNsongan/GhostPacket",
} as const;
