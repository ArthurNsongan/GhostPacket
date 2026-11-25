// Static facts shown in the Kiro Telemetry drawer and on the home page.
// Update `rustTests` and `wasmGzipKb` when the crate changes
// (`cargo test --release` and the `copy-wasm` line of `npm run wasm`).
export const BUILD_INFO = {
  coreVersion: "0.2.0",
  rustTests: 51,
  wasmGzipKb: 252,
  steering: ["product", "tech", "structure", "wasm-determinism", "ui-design-system"],
  specs: ["core-system", "binary-protocol", "acoustic-fsk", "optical-fountain", "judge-demo-ui", "platform-v2"],
  hooks: ["fuzz-noise-channel", "wasm-no-panic-guard", "ts-typecheck-on-save", "kiroween-audit"],
  agents: ["dsp-security-auditor"],
  mcpTools: ["inspect_frame_hex", "run_channel_benchmark", "check_kiroween_compliance"],
  repository: "https://github.com/ArthurNsongan/GhostPacket",
} as const;
