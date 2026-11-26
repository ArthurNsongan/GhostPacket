---
inclusion: always
---

# GhostPacket — Tech stack

## Core (Rust → WebAssembly)
- Single crate: `crates/ghostpacket-core`, `crate-type = ["cdylib", "rlib"]`.
- Target: `wasm32-unknown-unknown`, built with `wasm-pack build --target web`.
- Allowed dependencies (pure Rust, WASM-friendly): `wasm-bindgen`, `js-sys`, `serde`, `serde-wasm-bindgen`, `postcard`, `lz4_flex`, `crc32fast`, `ed25519-dalek`, `sha2`, `rustfft`, and for optional end-to-end encryption `chacha20poly1305`, `pbkdf2`, `zeroize` (all with default features off: no `getrandom`).
- No source of randomness in the crate: Ed25519 seeds and noise seeds come from the caller (`crypto.getRandomValues` on the web, constants in tests).
- Tests: `cargo test --release --manifest-path crates/ghostpacket-core/Cargo.toml` (91: protocol v1/v2 vectors incl. round ledgers, FSK (audible and ultrasonic) and OFDM channel fuzz, fountain fuzz, ChromaCrypt, wide fountain and Chimera bundles, vault).

## Transports (spec `.kiro/specs/high-speed-transports/`)
| Channel | Module | Frames | Rate |
|---|---|---|---|
| 4-FSK robust / fast | `fsk.rs` | v1 ≤ 512 B | 133 / 333 bit/s |
| Ultrasonic Whisper (4-FSK at 17.6–19.6 kHz, ≥ 44.1 kHz) | `fsk.rs` | ≤ 256 B | 400 bit/s |
| OFDM chord (32 DQPSK subcarriers) | `ofdm.rs` | ≤ 16 KB | ≈ 4 kbit/s |
| Fountain QR (16-byte blocks) | `fountain.rs` | v1 ≤ 512 B | ≈ 1 frame / 4 s |
| ChromaCrypt 44×44 × 8 colors + wide fountain | `chroma.rs`, `fountain_wide.rs` | v1 and v2 ≤ 131 150 B | ≈ 36 kbit/s at 15 FPS |
| Chimera Turbo (matrices + OFDM bundles of droplets, one decoder) | `fountain_wide.rs` + SDK `chimera-turbo.ts` | ≤ 131 150 B | light rate + ≈ 0.7 droplet/s by sound |
| WebRTC LAN (DataChannel, QR / OFDM signaling, no server) | SDK `lan-link.ts` | ≤ 131 150 B per message | local network (10.6 KB in ≈ 10 ms) |
- GPKT v2 (`protocol.rs`, version 0x02, u32 length) carries `ImageDocument` (≤ 64 KB WebP / JPEG / PNG made by the browser encoder, `image-codec.ts`) and large `LedgerBatchDelta` round ledgers (0x06, ≤ 64 entries; `sealCompact` keeps v1 when the ledger fits).

## Server verifier (`crates/ghostpacket-verifier`)
- Native binary + library that depends on `ghostpacket-core` by path, so the server runs exactly the same verification code as the browser.
- HTTP on `std::net` only (no framework). Extra dependencies: `serde`, `serde_json`, `sha2`, `zeroize`.
- CLI: `verify <files…>` and `serve --addr … (--trust <hex> … | --tofu) [--ledger file.jsonl] [--allow-origin <origin>] [--max-ledger N]`.
- Secrets only from the environment: `GHOSTPACKET_PASSPHRASE`, `GHOSTPACKET_TOKEN`.
- Hardening: 5 s deadline per request, head ≤ 2 KiB, one numeric `Content-Length` ≤ 131 150 (GPKT v2), no `Transfer-Encoding`, `application/octet-stream` only, exact `Origin` match, ≤ 32 connections (≤ 4 per IP), token bucket, one PBKDF2 at a time, merged post-decryption error codes, append-only JSONL ledger with `sync_data`.
- Tests: `cargo test --release --manifest-path crates/ghostpacket-verifier/Cargo.toml` (real TCP).

## Monorepo
- npm workspaces from the root `package.json` (`packages/*`, `apps/*`), one root `package-lock.json`, Node ≥ 23.6. `mcp-server/` keeps its own lockfile.
- Root scripts: `npm run wasm`, `npm run build:portal`, `npm run build:pages` (all apps merged into `pages-out/` under `/`, `/clinic/`, `/tontine/`), `npm run dev:portal|dev:clinic|dev:tontine`, `npm run build:sdk`, `npm run typecheck` (every workspace), `npm run test:sdk`, `npm run test:sdk:browser`, `npm run audit`.
- E2E (headless Chrome, versioned in `scripts/e2e/`): `node scripts/build-pages.mjs --base /GhostPacket`, then `node scripts/e2e/apps.mjs` (36 checks: vault identity, clinic, ChromaCrypt photo, tontine, round ledger over OFDM, OFDM image, E2EE image over Chimera Turbo, WebRTC LAN, Ultrasonic Whisper; `GP_ONLY=clinic,tontine,portal` runs a subset) and `node scripts/e2e/portal.mjs` (30 checks, fake mic and camera from `fake-media.mjs`). `GP_BASE_URL=<deployed URL>` runs both against the live site.

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
| Full frame | v1 ≤ 512 bytes (FSK, QR); v2 ≤ 131 150 bytes (ChromaCrypt; OFDM ≤ 16 KB) |
| Preset payloads | 150–300 bytes |
| Encode + sign | < 15 ms |
| Verify | < 15 ms |
| Encrypted encode / decrypt + verify (PBKDF2 40k) | < 500 ms (≈ 90 ms measured in WASM) |
| 1024-point FFT | < 5 ms |
| Gzipped `.wasm` | < 350 KB (285 KB measured) |
| Identity vault unlock (PBKDF2 210k) | < 1 s (once per session) |
| ChromaCrypt matrix scan | < 5 ms (≈ 0.8 ms measured for 312 px) |

## Security
- Zero committed secrets: `.env*`, `*.pem`, `*.key` are ignored.
- The emitter's signing key is generated in the browser and stays in session memory. Issuer apps (GhostClinic, GhostTontine) may keep it across sessions only as a vault sealed by the core (`vault.rs`: PBKDF2-HMAC-SHA256 210k + ChaCha20-Poly1305, public key as AAD, passphrase ≥ 10 bytes); the seed itself is never stored.
- Untrusted inputs (frames, droplets, audio samples): lengths are bounded before any allocation.
- Weak Ed25519 public keys (small-order points) are refused everywhere a key is pinned (`crypto::validate_public_key`).
- Server responses are untrusted on the client: the outbox keeps only well-formed codes and timestamps, and refuses redirects.
