# GhostPacket

GhostPacket transmits a short **Ed25519-signed document** between two nearby devices with no network, no server and no Bluetooth pairing. Two physical channels are available, both one-way:

- **Sound**: a 4-FSK continuous-phase modem with Reed-Solomon, played on the speaker and decoded from the microphone.
- **Light**: a Luby Transform fountain code shown as a burst of QR codes on screen and read by a camera. The receiver reconstructs the frame even when 30 to 50 % of the images are missed.

The receiver checks CRC32, then Ed25519, and either shows the document or rejects it with an explicit code (`CRC32_MISMATCH`, `INVALID_SIGNATURE`, …).

Target users: tontine treasurers, rural clinics and aid distributors in low-coverage areas. The three built-in presets are a **Dakar Tontine Receipt** (Tilène Market), a **Ndiob Rural Clinic Prescription** and a **Kaolack Flood Relief Voucher**.

> Kiroween 2026, **Frankenstein** category: Rust/WASM cryptography and DSP, a 1980s-style acoustic modem and optical fountain codes, all in one static web page.

## Judge demo (under 30 s, 1 click, no hardware)

1. Open the app and stay on **Virtual lab**.
2. Click **Summon the full demo**.

The scenario takes about **15 s** (measured in headless Chrome): it signs the Dakar tontine receipt, sends it by sound with white noise at 10 dB SNR, sends it by QR with 30 % of images lost, verifies the signature on both paths, then curses (flips) one bit and shows the `CRC32_MISMATCH` rejection in the hex inspector. The sliders change the SNR (0 to 25 dB), the loss rate (0 to 60 %) and the frame rate.

QR codes in the loopback are actually rendered on a canvas and read back with `jsQR`. Noise and loss come from the same deterministic simulator used by the Rust fuzz tests.

**Field mode PC ↔ phone** uses the real speaker, microphone, screen and rear camera. Both devices must use the same modem mode. Robust mode (15 ms per symbol) is the one meant for the air. Microphone and camera require HTTPS or `localhost`. If permission is denied, the app falls back to the virtual loopback.

## Measured numbers

| Measure | Value |
|---|---|
| Frame size (3 presets) | 296 / 350 / 311 bytes (limit 512) |
| Payload | 220 to 274 bytes (target 150–300) |
| Encode + sign | ~1 ms in the browser |
| Verify | ~0.5 ms |
| WASM | ~240 KB gzip (budget 350 KB) |
| Acoustic burst, fast / robust | 8.1 s / 20.3 s for 296 bytes |
| FSK decoding | 100 % at 6 to 20 dB SNR (fuzz suite) |
| Clock drift and room echo | 100 % from −300 to +300 ppm with two reflections, at 12 dB SNR (symbol timing tracking) |
| Field mode in Chrome (fake mic, fake camera) | microphone: verified after 26.3 s (350-byte frame, robust mode, 23.6 s burst); camera: 20/20 blocks from blurred QR codes in 3.6 s |
| Fountain decoding | 100 % of 100 seeds at 30, 40 and 50 % loss, ~1.23 K droplets received on average |

LZ4 is applied only when it shrinks the payload. On these short, varied texts `postcard` is already compact, so the encoder keeps the raw payload.

## Frame format

```text
[GPKT 4B][Version 1B][Flags 1B][Length N 2B][Payload N B][CRC32 4B][Ed25519 64B]   = 76 + N ≤ 512 bytes
```

The full specification, with the verification order and every error code, is in [`.kiro/specs/binary-protocol/design.md`](.kiro/specs/binary-protocol/design.md).

## Repository layout

```text
crates/ghostpacket-core/   Rust → WASM: protocol, crypto, Reed-Solomon, FSK, fountain, channel simulator
web/                       Next.js static export (UI, Web Audio, Canvas, camera)
mcp-server/                MCP server ghostpacket-inspector (stdio)
scripts/                   Node scripts called by the Kiro hooks
.kiro/                     steering, specs, hooks, MCP settings
.github/workflows/         GitHub Pages deployment
```

All cryptography, compression, DSP and coding runs in the Rust crate. `web/` only does hardware I/O and rendering, through `web/src/lib/wasm-bridge.ts`.

## Build

Requirements: Rust with `wasm32-unknown-unknown`, `wasm-pack`, and Node ≥ 23.6.

```powershell
cargo test --release --manifest-path crates/ghostpacket-core/Cargo.toml   # 38 tests: vectors + fuzz
npm --prefix web install
npm --prefix web run wasm        # wasm-pack → web/src/wasm + web/public/wasm
npm --prefix web run build       # static export in web/out
npx serve web/out                # or any static host
```

The generated WASM glue is committed, so `npm run build` works without a Rust toolchain.

## Deploy

Live demo: **https://arthurnsongan.github.io/GhostPacket/**

**GitHub Pages, branch mode** (default): run `node scripts/deploy-gh-pages.mjs`. It builds the static export with the base path `/<repo>`, adds `.nojekyll` (otherwise Jekyll drops `_next/`) and pushes the result to the `gh-pages` branch. One-time setup: *Settings → Pages → Source: Deploy from a branch → `gh-pages` / root*. It needs no GitHub Actions minutes and no secret.

**GitHub Pages, Actions mode** (optional): `.github/workflows/pages.yml` does the same build in CI. It is manual-only; switch *Source* to *GitHub Actions* and run it from the Actions tab.

The base-path build was checked locally under `/GhostPacket/`: demo, WASM, AudioWorklet and fonts load with no 404.

**Vercel / Netlify / Cloudflare Pages**: set the root directory to `web`, build command `npm run build`, output directory `out`.

After rebuilding the WASM or editing the presets, reconnect the `ghostpacket-inspector` MCP server in Kiro: it loads both once at start-up.

## Field test (PC ↔ phone)

Microphone and camera access on a phone needs HTTPS, so use the deployed URL.

1. Open the URL on both devices, choose **Field mode PC ↔ phone** and the **robust** modem on both. Put the phone in airplane mode once the page has loaded.
2. **Sound**: on the phone choose *This device receives* → *Listen (microphone)*. On the PC choose *This device sends* → *Send over the speaker*, volume around 70 %, devices 30 to 80 cm apart. `SYNC LOCK` should light up within a few seconds; the verdict appears when the burst ends (about 20 to 24 s).
3. **Light**: on the phone choose *Scan the screen (camera)*. On the PC choose *Show the full-screen QR stream*. Hold the phone so the QR code fills about half of the camera view; the frame is usually rebuilt in a few seconds.
4. Check that the issuer fingerprint shown on the phone matches the session key at the top of the PC screen.

If the sound path fails, lower the speaker volume (clipping), move closer, or cut background noise. The status line shows the symbol SNR and the number of bytes Reed-Solomon corrected.

## How we built GhostPacket with Kiro

- **Specs** (`.kiro/specs/`): five specs (`core-system`, `binary-protocol`, `acoustic-fsk`, `optical-fountain`, `judge-demo-ui`) with EARS requirements, a design and a task list. The design docs record the measured results and the decisions that came out of failing tests.
- **Steering** (`.kiro/steering/`): `product`, `tech` and `structure` are always included. `wasm-determinism` is loaded on `crates/**/*.rs` and forbids panics, implicit randomness and unbounded allocations. `ui-design-system` is loaded on `web/src/**` and carries the "Spectral Telemetry" visual system.
- **Hooks** (`.kiro/hooks/`, v1 format):
  - `fuzz-noise-channel` runs the acoustic and optical fuzz suites whenever a codec file is saved.
  - `wasm-no-panic-guard` rejects `unwrap`, `expect` and `panic!` in `src/`.
  - `ts-typecheck-on-save` runs `tsc --noEmit`.
  - `kiroween-audit` runs on `Stop` and checks `.kiro/` tracking, secrets, the licence, WASM size and the full test suite.
- **MCP** (`mcp-server/`): `ghostpacket-inspector` loads the same `.wasm` binary as the browser and exposes three tools: `inspect_frame_hex`, `run_channel_benchmark` and `check_kiroween_compliance`.

The fuzz hook caught two real bugs in the fountain code:
- The low bits of `xorshift64*` are weak, so one block was never covered on some sessions.
- The planned degree distribution needed about 1.5 K droplets.

Both fixes are documented in `.kiro/specs/optical-fountain/design.md`.

An "air" test (clock drift between devices plus room echo) then showed the acoustic demodulator failing from ±100 ppm with echo, the normal gap between a PC and a phone. An early-late symbol timing tracker fixed it; the case is now part of the fuzz suite (`.kiro/specs/acoustic-fsk/design.md`).

## Security

- The signing key comes from 32 bytes of `crypto.getRandomValues`, stays in the tab's memory and is never sent anywhere.
- The issuer's public key is inside the signed document. An optional keyring rejects unknown issuers with `UNTRUSTED_ISSUER`.
- Untrusted lengths are bounded before allocation: frame ≤ 512 bytes, decompressed size ≤ 4096 bytes (LZ4 bomb blocked), ≤ 256 pending droplets.
- No network call at runtime: fonts are self-hosted and the WASM is served from the same origin.

## Licence

MIT, see [LICENSE](LICENSE).
