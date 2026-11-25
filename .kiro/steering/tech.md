---
inclusion: always
---

# GhostPacket — Tech stack

## Core (Rust → WebAssembly)
- Single crate: `crates/ghostpacket-core`, `crate-type = ["cdylib", "rlib"]`.
- Target: `wasm32-unknown-unknown`, built with `wasm-pack build --target web`.
- Allowed dependencies (pure Rust, WASM-friendly): `wasm-bindgen`, `js-sys`, `serde`, `serde-wasm-bindgen`, `postcard`, `lz4_flex`, `crc32fast`, `ed25519-dalek`, `sha2`, `rustfft`, and for optional end-to-end encryption `chacha20poly1305`, `pbkdf2`, `zeroize` (all with default features off: no `getrandom`).
- No source of randomness in the crate: Ed25519 seeds and noise seeds come from the caller (`crypto.getRandomValues` on the web, constants in tests).
- Tests: `cargo test --release --manifest-path crates/ghostpacket-core/Cargo.toml`.

## Web (`web/`)
- Next.js (App Router) as a static export, TypeScript `strict`, Tailwind CSS v4.
- Web Audio API (`AudioContext`, `AudioWorklet`, `ScriptProcessor` fallback) for the acoustic channel.
- Canvas 2D for the spectrogram, fountain grid and QR codes.
- Camera: `getUserMedia` + native `BarcodeDetector`, `jsQR` fallback.
- Offline: same-origin service worker `web/public/sw.js`; four static routes with `trailingSlash`.
- Build: `npm run build` = `next build` + `scripts/fix-next-export.mjs` (flattens Next 16 prefetch files for static hosts).
- Fonts self-hosted with `@fontsource`.
- Type check: `npm --prefix web run typecheck` (`tsc --noEmit`).

## Kiro tooling
- Local MCP server `ghostpacket-inspector` (`mcp-server/`, stdio, `@modelcontextprotocol/sdk`), run directly by Node ≥ 23.6 (type stripping).
- v1 hooks in `.kiro/hooks/` (channel fuzzing, panic guard, type check, final audit).

## Budgets
| Measure | Budget |
|---|---|
| Full frame | ≤ 512 bytes |
| Preset payloads | 150–300 bytes |
| Encode + sign | < 15 ms |
| Verify | < 15 ms |
| Encrypted encode / decrypt + verify (PBKDF2 40k) | < 500 ms (≈ 90 ms measured in WASM) |
| 1024-point FFT | < 5 ms |
| Gzipped `.wasm` | < 350 KB |

## Security
- Zero committed secrets: `.env*`, `*.pem`, `*.key` are ignored.
- The emitter's signing key is generated in the browser and stays in session memory.
- Untrusted inputs (frames, droplets, audio samples): lengths are bounded before any allocation.
