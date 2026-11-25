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

## Monorepo
- npm workspaces from the root `package.json` (`packages/*`, `apps/*`), one root `package-lock.json`, Node ≥ 23.6. `mcp-server/` keeps its own lockfile.
- Root scripts: `npm run wasm`, `npm run build:portal`, `npm run build:pages` (all apps merged into `pages-out/` under `/`, `/clinic/`, `/tontine/`), `npm run dev:portal|dev:clinic|dev:tontine`, `npm run build:sdk`, `npm run typecheck` (every workspace), `npm run test:sdk`, `npm run test:sdk:browser`, `npm run audit`.
- App E2E: `node scripts/build-pages.mjs --base /GhostPacket && node scripts/e2e-apps.mjs` (headless Chrome, 22 checks).

## SDK package (`packages/ghostpacket-sdk`)
- `ghostpacket-sdk`: the TypeScript source is consumed directly by the apps (`exports`: `ghostpacket-sdk/<module>` → `src/<module>.ts`).
- `npm run build:sdk` (`scripts/build-sdk.mjs`) emits the publishable ES module build into `dist/` (`dist/package.json`, `lib/`, `wasm/`, `assets/`); pack it with `npm pack ./packages/ghostpacket-sdk/dist`.
- Entry `src/index.ts` resolves assets with `new URL(…, import.meta.url)`; `GhostPacketSDK.load({ wasm, workletUrl, storage, seed })` overrides them.
- Runtime dependencies: `jsqr`, `qrcode-generator`. Storage falls back to memory when `localStorage` is missing (Node).
- Tests: `npm run test:sdk` (Node) and `npm run test:sdk:browser` (headless Chrome with a fake microphone and camera).

## UI package (`packages/ghostpacket-ui`)
- `ghostpacket-ui`: React 19 client components shipped as TypeScript source (`ghostpacket-ui/<Component>`), Tailwind classes only, theme tokens provided by the app's CSS.

## Apps (`apps/*`)
- Next.js (App Router) static exports, TypeScript `strict`, Tailwind CSS v4, `transpilePackages: ["ghostpacket-sdk", "ghostpacket-ui"]`, `turbopack.root` = repo root.
- Web Audio API (`AudioContext`, `AudioWorklet`, `ScriptProcessor` fallback) for the acoustic channel.
- Canvas 2D for the spectrogram, fountain grid and QR codes.
- Camera: `getUserMedia` + native `BarcodeDetector`, `jsQR` fallback.
- Offline: same-origin service worker `public/sw.js` per app; static routes with `trailingSlash`.
- Build: `next build` + `scripts/fix-next-export.mjs` (flattens Next 16 prefetch files for static hosts); `prebuild` copies the WASM and worklet into `public/`.
- Fonts self-hosted with `@fontsource`.
- Type check: `npm run typecheck` at the root (`tsc --noEmit` in every workspace).

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
