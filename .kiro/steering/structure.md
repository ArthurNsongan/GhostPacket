---
inclusion: always
---

# GhostPacket — Repository structure

## Separation rule
All **cryptography, compression, FSK DSP, FEC and fountain code** logic lives only in `crates/ghostpacket-core`. The `web/` folder only does:
- hardware I/O (speaker, microphone, screen, camera);
- UI state and Canvas rendering;
- calls into WASM through `web/src/lib/wasm-bridge.ts` (the only module that imports the WASM package).

## Layout
```text
.kiro/                     steering, specs, hooks, settings (always committed)
crates/ghostpacket-core/
  src/lib.rs               wasm-bindgen API (panic-free wrappers)
  src/error.rs             GhostError: machine code + message
  src/schema.rs            structured documents + postcard serialization
  src/protocol.rs          GPKT frame: LZ4 + CRC32 + Ed25519
  src/crypto.rs            Ed25519, GPKT-XXXX-XXXX fingerprint
  src/fec.rs               Reed-Solomon GF(256)
  src/fsk.rs               4-CPFSK modulation/demodulation, Goertzel, timing recovery, FFT
  src/fountain.rs          Luby Transform + peeling decoder
  src/channel_sim.rs       AWGN noise, droplet loss, bit flip
  tests/                   protocol vectors + channel fuzzing
mcp-server/                ghostpacket-inspector MCP server (stdio)
scripts/                   Node scripts called by the hooks
web/src/lib/               types, presets, wasm-bridge, audio/optical engines, demo runner
web/src/components/        UI components (Dual-Canvas, inspector, field mode, …)
web/src/wasm/              wasm-pack output (generated, committed)
```

## Conventions
- Rust: `snake_case` modules, errors as `Result<T, GhostError>`, bounds as `SCREAMING_SNAKE_CASE` constants.
- TypeScript: React components in `PascalCase.tsx`, utility modules in `kebab-case.ts`.
- Error codes shown in the UI are `SCREAMING_SNAKE_CASE` (`CRC32_MISMATCH`); messages are English sentences.
- Field presets are defined twice and must stay identical: `web/src/lib/presets.ts` and `crates/ghostpacket-core/tests/common/mod.rs`.
