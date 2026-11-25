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

## Server verifier (`crates/ghostpacket-verifier`)
- Native binary + library that depends on `ghostpacket-core` by path, so the server runs exactly the same verification code as the browser.
- HTTP on `std::net` only (no framework). Extra dependencies: `serde`, `serde_json`, `sha2`, `zeroize`.
- CLI: `verify <files…>` and `serve --addr … (--trust <hex> … | --tofu) [--ledger file.jsonl] [--allow-origin <origin>] [--max-ledger N]`.
- Secrets only from the environment: `GHOSTPACKET_PASSPHRASE`, `GHOSTPACKET_TOKEN`.
- Hardening: 5 s deadline per request, head ≤ 2 KiB, one numeric `Content-Length` ≤ 512, no `Transfer-Encoding`, `application/octet-stream` only, exact `Origin` match, ≤ 32 connections (≤ 4 per IP), token bucket, one PBKDF2 at a time, merged post-decryption error codes, append-only JSONL ledger with `sync_data`.
- Tests: `cargo test --release --manifest-path crates/ghostpacket-verifier/Cargo.toml` (real TCP).

## SDK package (`sdk/`)
- `ghostpacket-sdk`, ES modules, built from `web/src/lib` by `node scripts/build-sdk.mjs` (`tsc -p web/tsconfig.sdk.json` → `sdk/dist`, generated, not committed), with the WASM glue, the `.wasm` and the capture worklet.
- Entry `web/src/lib/index.ts` resolves assets with `new URL(…, import.meta.url)`; `GhostPacketSDK.load({ wasm, workletUrl, storage, seed })` overrides them.
- Runtime dependencies: `jsqr`, `qrcode-generator`. Storage falls back to memory when `localStorage` is missing (Node).
- Tests: `npm --prefix sdk test` (Node) and `npm --prefix sdk run test:browser` (headless Chrome with a fake microphone and camera).

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
- Weak Ed25519 public keys (small-order points) are refused everywhere a key is pinned (`crypto::validate_public_key`).
- Server responses are untrusted on the client: the outbox keeps only well-formed codes and timestamps, and refuses redirects.
