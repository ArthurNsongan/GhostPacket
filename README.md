# GhostPacket

GhostPacket transmits a short **Ed25519-signed document** between two nearby devices with no network, no server and no Bluetooth pairing. Two physical channels are available, both one-way:

- **Sound**: a 4-FSK continuous-phase modem with Reed-Solomon, played on the speaker and decoded from the microphone.
- **Light**: a Luby Transform fountain code shown as a burst of QR codes on screen and read by a camera. The receiver reconstructs the frame even when 30 to 50 % of the images are missed.

The receiver checks CRC32, then Ed25519, and either shows the document or rejects it with an explicit code (`CRC32_MISMATCH`, `INVALID_SIGNATURE`, …).

**Live:** https://arthurnsongan.github.io/GhostPacket/ with two apps built from the same skeleton:

| App | URL | What it does |
|---|---|---|
| **Portal** (*The Haunted Telegraph*) | `/GhostPacket/` | the showcase and test bench below |
| **GhostClinic** (*The Apothecary's Ward*) | `/GhostPacket/clinic/` | ward records on the device; signed (optionally encrypted) prescriptions with no patient name in the frame, handed to the pharmacy phone, dispensed once |
| **GhostTontine** (*The Midnight Vault*) | `/GhostPacket/tontine/` | members, rounds and pot; a signed receipt in each member's wallet; single-use aid vouchers paid out once at the pay-out desk |

Both apps have a **virtual hand-over** (the real QR pipeline in software, 30 % of frames lost), so one device and no permission are enough. Every app has a **Haunted / Clean Field** switch in the header ([V3](#v3-skeleton-crew)).

The portal has four pages:

| Page | What it shows |
|---|---|
| **Home** | the problem, three field use cases, measured numbers, a 1-click launcher |
| **How It Works** | animated pipeline, security threat model, SDK integration snippets, `.gpkt` wire format and a drag-and-drop verifier |
| **Simulation** | the 1-click demo, your own message with optional end-to-end encryption, the Chimera dual-channel race, the tamper lab (click any byte), the Crypt Ledger |
| **Test (PC ↔ Phone)** | real speaker → microphone and screen → camera transfer, identity QR and trusted keyring, anti-replay ledger |

V2 features (`.kiro/specs/platform-v2/`):
- **Your own messages** (sender, title, up to 240 bytes of text), not just the three presets.
- **Optional end-to-end encryption**: ChaCha20-Poly1305 under a PBKDF2-HMAC-SHA256 key (40 000 iterations, fresh salt per frame), so a prescription played aloud in a waiting room stays private. Wrong passphrase → `DECRYPTION_FAILED`.
- **Anti-replay Crypt Ledger**: a receipt or voucher presented twice raises `REPLAY DETECTED · ALREADY REDEEMED`, even offline.
- **Trusted keyring**: the sender shows an identity QR; in strict mode any other signer is rejected with `UNTRUSTED_ISSUER`.
- **Offline**: a same-origin service worker; after one visit the site works in airplane mode (`OFFLINE · AIR-GAP ACTIVE`).
- **SDK package** `ghostpacket-sdk` (`packages/ghostpacket-sdk/`): sealing, both transmitters, both receivers and verification for another app, with no bundler required ([below](#sdk-package)).
- **Offline-to-cloud sync**: proofs verified offline wait in an outbox and are uploaded later to `ghostpacket-verifier`, a Rust server that re-verifies them and catches a voucher redeemed on two offline devices (`.kiro/specs/sdk-and-sync/`, [below](#server-verifier-and-offline-to-cloud-sync)).

Target users: tontine treasurers, rural clinics and aid distributors in low-coverage areas. The three built-in presets are a **Dakar Tontine Receipt** (Tilène Market), a **Ndiob Rural Clinic Prescription** and a **Kaolack Flood Relief Voucher**.

> Kiroween 2026, **Skeleton Crew** category: one lean air-gap skeleton (Rust/WASM core, TypeScript SDK, React UI kit) powering two distinct offline apps plus the portal.

## V3: Skeleton Crew

The skeleton is `crates/ghostpacket-core` + `packages/ghostpacket-sdk` + `packages/ghostpacket-ui`. Apps contain no crypto or DSP code and import the skeleton only by package name; `scripts/kiroween-audit.mjs` fails if an app bypasses it. Spec: `.kiro/specs/v3-skeleton-crew/`.

| Shared piece | Used by |
|---|---|
| `AppFrame` (header, emblem, offline badge, theme switches, atmosphere) | portal, clinic, tontine |
| `AirSender`, `AirReceiver`, `VirtualHandover` | clinic, tontine |
| `ResultCard`, `CryptLedger`, `ProofOutboxPanel`, `IdentityQr` | all three |
| `records.ts` (bounded local collections), `setStorageNamespace` (per-app data on one origin) | clinic, tontine |
| `redemption-policy.ts` + `redeemOnce` + `IssuerGate` | clinic (dispense), tontine (pay out, wallet) |

**Redemption rule.** A valid signature alone never releases medicine or money: anyone can sign a voucher with a fresh key. The pharmacy and the pay-out desk require the expected document type, no DEMO flag, a pinned issuer (fingerprint checked with the issuer), a plausible timestamp and an unexpired voucher. They then record the redemption in an append-only ledger that fails closed when storage is full.

**Redesign ("Midnight Atelier", haunted graveyard).** Haunted Mode (the default) keeps classy surfaces over an eerie but playful haunt:
- Fraunces titles with a soft "wonky" italic accent, Geist for the interface, Geist Mono for telemetry (all self-hosted);
- one warm candlelight accent per app; mist green only for "verified", garnet only for errors;
- fine-line audio-reactive emblems (lantern, plague-doctor mask, wax seal);
- a pale moon and a candle glow at rest, resident bats, a tiny bat flock on every click, a swarm while a frame is in the air and a blood moon on rejection;
- a full-page three.js backdrop, loaded on demand: a misty graveyard under a huge moon, tombstones, dead trees, jack-o'-lanterns, translucent spectres and will-o'-the-wisps, with pointer parallax and a camera that walks in on scroll;
- lurking spectres animated with GSAP (glowing eyes, flicker, they dissolve near the pointer and lunge with "Boo." when clicked) that follow, retreat or close in with the protocol;
- ghostly click sounds (moan, echoing giggle, whisper, bat squeak, pumpkin pop, whoosh) plus the protocol cues (theremin, clock bell, organ fifth, tritone, funeral bell) and an optional crypt drone — all synthesized, silent while the modem runs.

Every sound is off by default and silenced instantly while the real modem plays or listens. **Clean Field Mode** removes the decoration for real clinics and markets.

```powershell
npm run build:pages -- --base /GhostPacket   # portal + /clinic + /tontine merged into pages-out/
node scripts/e2e/apps.mjs                    # 36 headless Chrome checks of both apps and the V3 transports
node scripts/e2e/portal.mjs                  # 30 checks of the portal (fake microphone and camera)
npm run dev:clinic                           # or dev:portal, dev:tontine
```

### High-speed transports and photos (spec `.kiro/specs/high-speed-transports/`)

| Channel | Frames | Measured |
|---|---|---|
| 4-FSK robust / fast (sound) | ≤ 512 B | 133 / 333 bit/s |
| **Ultrasonic Whisper** (sound: the 4-FSK modem at 17.6–19.6 kHz, 5 ms symbols) | ≤ 256 B | 400 bit/s: a 155-byte signed identity card in 3.6 s; energy under 16 kHz more than 30 dB below the signal; best-effort on real speakers |
| **OFDM chord** (sound: 32 DQPSK subcarriers, 1.5–7.4 kHz, RS 255/223) | ≤ 16 KB | 4.0–4.2 kbit/s: a 12 KB photo in 24 s at 15 dB SNR; survives ±300 ppm clock drift over 33 s, room echo, a receiver 30 dB quieter, clipping |
| Fountain QR (light) | ≤ 512 B | a 300-byte frame in about 4 s at 30 % loss |
| **ChromaCrypt** (light: 44×44 cells, 8 calibrated colors, 525 B per matrix, wide fountain) | ≤ 128 KB | a 12 KB photo in ≈ 2.8 s at 15 FPS with 30 % of matrices lost (≈ 36 kbit/s); 0.8 ms per scan |
| **Chimera Turbo** (ChromaCrypt + OFDM bundles of the same droplets, one decoder) | ≤ 128 KB | a 10.6 KB encrypted photo in 8 s with the camera covered for the first 6 s: 17–21 droplets by light, 4–6 by sound |
| **WebRTC LAN** (DataChannel on the same Wi-Fi or hotspot; offer by QR, answer by QR or OFDM; no server) | ≤ 128 KB per frame | ≈ 200-character pairing codes, link open in ≈ 2.5 s, then 10.6 KB in ≈ 10 ms |

- **GPKT v2** frames keep the v1 layout with a u32 length. `ImageDocument` carries a WebP or JPEG re-encoded on the device to Micro 4 KB, Standard 15 KB or High 48 KB, inside the signed document.
- GhostClinic attaches a rapid-test photo to a prescription (`IMG-xxxx → RX-xxxxx`). The pharmacy sees it only after verification; the image tiles burn through a spectral fog as fountain blocks arrive.
- The portal's Simulation and Test pages have a **high-speed lab**: an image, optionally end-to-end encrypted, over ChromaCrypt (loss slider), OFDM (noise slider), Chimera Turbo (cover the camera or jam the sound mid-transfer) or a WebRTC LAN link, virtual or between two devices. An **Ultrasonic Whisper** panel exchanges a signed identity card at 17.6–19.6 kHz and pins the key.
- GhostTontine seals the whole round in one **round ledger** (`LedgerBatchDelta`, doc type 0x06, up to 64 contributions; v1 when it fits, v2 otherwise) and broadcasts it over the OFDM chord to every member phone at once; each phone lists the receipts of its wallet that the ledger confirms.
- **Persistent issuer identity:** GhostClinic and GhostTontine seal their signing key in a 101-byte vault (Rust: PBKDF2-HMAC-SHA256 210k + ChaCha20-Poly1305, public key authenticated). A pharmacy's pin now survives reloads. "Continue with a session key" keeps the one-click demo.

Not done: IndexedDB storage (localStorage is used) and X25519 key agreement (E2EE is passphrase-based). Ultrasonic, OFDM and ChromaCrypt are validated in software and headless Chrome; real speaker, microphone and phone-camera measurements are still to do. Open decision: a dedicated origin instead of the shared `github.io` one (`.kiro/specs/v3-skeleton-crew/design.md` → *Known limits*).

## Judge demo (under 30 s, 1 click, no hardware)

On the home page click **Launch the 20 s simulation** (or open **Simulation** and click **Summon the full demo**).

The scenario takes about **15 s** (measured in headless Chrome): it signs the Dakar tontine receipt, sends it by sound with white noise at 10 dB SNR, sends it by QR with 30 % of images lost, verifies the signature on both paths, flags the second delivery of the same document as a replay, then curses (flips) one bit and shows the `CRC32_MISMATCH` rejection in the hex inspector.

Then try, on the same page:
- **Chimera race**: start it, then press *Jam audio* or *Block camera 85 %*. The other channel still delivers a verified frame.
- **Tamper lab**: *Curse payload* → `CRC32_MISMATCH`, *Curse signature* → `INVALID_SIGNATURE`, *Forge rogue key* → `UNTRUSTED_ISSUER`, *Wrong passphrase* → `DECRYPTION_FAILED`; or click any byte of the frame and see which layer caught it.
- **Write a message**, turn on end-to-end encryption, send it over QR: the receiver decrypts and shows the plaintext; the inspector marks the payload `ENC`. The sliders change the SNR (0 to 25 dB), the loss rate (0 to 60 %) and the frame rate.

QR codes in the loopback are actually rendered on a canvas and read back with `jsQR`. Noise and loss come from the same deterministic simulator used by the Rust fuzz tests.

**Field mode PC ↔ phone** uses the real speaker, microphone, screen and rear camera. Both devices must use the same modem mode. Robust mode (15 ms per symbol) is the one meant for the air. Microphone and camera require HTTPS or `localhost`. If permission is denied, the app falls back to the virtual loopback.

## Measured numbers

| Measure | Value |
|---|---|
| Frame size (3 presets) | 296 / 350 / 311 bytes (limit 512) |
| Payload | 220 to 274 bytes (target 150–300) |
| Encode + sign | ~1 ms in the browser |
| Verify | ~0.5 ms |
| Encrypted encode / decrypt + verify | ~89 / ~90 ms in WASM (PBKDF2 40 000 iterations) |
| Largest encrypted custom message | 511 bytes |
| WASM | ~285 KB gzip (budget 350 KB) |
| Acoustic burst, fast / robust | 8.1 s / 20.3 s for 296 bytes |
| FSK decoding | 100 % at 6 to 20 dB SNR (fuzz suite) |
| Clock drift and room echo | 100 % from −300 to +300 ppm with two reflections, at 12 dB SNR (symbol timing tracking) |
| Field mode in Chrome (fake mic, fake camera) | microphone: verified after 26.3 s (350-byte frame, robust mode, 23.6 s burst); camera: 20/20 blocks from blurred QR codes in 3.6 s |
| Fountain decoding | 100 % of 100 seeds at 30, 40 and 50 % loss, ~1.23 K droplets received on average |
| Rust tests | 91 in the core (protocol v1/v2 vectors incl. encryption, weak keys, hostile lengths and round ledgers, FSK (audible and ultrasonic) and OFDM channel fuzz, fountain fuzz, wide fountain and Chimera bundles, ChromaCrypt, vault) + 13 in the server verifier (real TCP) |
| SDK package tests | 12 in Node (incl. sync against the real verifier and the redemption policy) + 11 in headless Chrome (every transmit / receive method with a fake mic and camera, sync 201 and 409) |
| V3 apps (headless Chrome, `scripts/e2e/apps.mjs`) | 36/36: issuer vault created, wrong passphrase refused, same fingerprint after reload; ChromaCrypt photo at 30 % loss verified and shown; image over OFDM at 15 dB; E2EE image over Chimera Turbo (both lanes count), refused without the passphrase then unlocked; WebRTC LAN delivery; Ultrasonic Whisper identity pinned; tontine round ledger broadcast over OFDM; clinic ward → sign → virtual hand-over → dispense once → refuse twice; tontine receipt → wallet, voucher → pay out once → refuse twice; per-app storage isolation, Clean Field Mode, per-app worker scope, 0 error / external request / 404 |
| SDK redemption policy (Node) | unpinned issuer, DEMO frame, expired voucher and future timestamp refused; guarded ledger cannot be cleared and fails closed on a storage error; namespaces isolate apps |
| Portal browser checks (headless Chrome, `/GhostPacket/` base path) | 30/30: pages, demo < 20 s, E2EE, tamper lab, replay, race, `.gpkt` verifier, field mic + camera, outbox → verifier sync, offline reload, 0 console error, 0 external request, 0 404 |

LZ4 is applied only when it shrinks the payload. On these short, varied texts `postcard` is already compact, so the encoder keeps the raw payload.

## Frame format

```text
[GPKT 4B][Version 1B][Flags 1B][Length N 2B][Payload N B][CRC32 4B][Ed25519 64B]   = 76 + N ≤ 512 bytes
```

Flags: b0 LZ4 · b1 FSK · b2 FOUNTAIN · b3 DEMO · b4 ENCRYPTED. An encrypted payload is `[salt 16][ciphertext][tag 16]`; the header is authenticated as AAD and the signature covers the ciphertext. A `.gpkt` file is simply the raw frame.

The full specification, with the verification order and every error code, is in [`.kiro/specs/binary-protocol/design.md`](.kiro/specs/binary-protocol/design.md).

## Repository layout

V3 is a "Skeleton Crew" monorepo: one skeleton (the Rust core, the SDK and the UI kit) and apps built only from it.

```text
crates/ghostpacket-core/     Rust → WASM: protocol, crypto, Reed-Solomon, FSK, fountain, channel simulator
crates/ghostpacket-verifier/ native server verifier + anti-replay ledger (reuses ghostpacket-core)
packages/ghostpacket-sdk/    TypeScript SDK: WASM bridge, transports, keyring, ledger, outbox (+ tests, example)
packages/ghostpacket-ui/     shared React components: spectrogram, fountain grid, conduit, inspector, seal, …
apps/portal/                 the GitHub Pages site (Home, How It Works, Simulation, Test)
mcp-server/                  MCP server ghostpacket-inspector (stdio)
scripts/                     Node scripts called by the Kiro hooks, SDK build, asset sync, gh-pages deploy
.kiro/                       steering, specs, hooks, agents, MCP settings
.github/workflows/           GitHub Pages deployment
```

All cryptography, compression, DSP and coding runs in the Rust crate. TypeScript only does hardware I/O and rendering, through `packages/ghostpacket-sdk/src/wasm-bridge.ts`. Apps import `ghostpacket-sdk/<module>` and `ghostpacket-ui/<Component>`; the audit checks that no app bypasses them.

## Build

Requirements: Rust with `wasm32-unknown-unknown`, `wasm-pack`, and Node ≥ 23.6.

```powershell
cargo test --release --manifest-path crates/ghostpacket-core/Cargo.toml       # 52 tests: vectors + fuzz
cargo test --release --manifest-path crates/ghostpacket-verifier/Cargo.toml   # 12 tests, real TCP
npm install                      # every workspace, one lockfile
npm run wasm                     # wasm-pack → packages/ghostpacket-sdk/wasm, copied into each app's public/
npm run build:portal             # static export in apps/portal/out
npm run typecheck                # tsc --noEmit in every workspace
npx serve apps/portal/out        # or any static host
```

The generated WASM glue is committed, so `npm run build:portal` works without a Rust toolchain.

## SDK package

`packages/ghostpacket-sdk` is the `ghostpacket-sdk` package. The apps compile its TypeScript source directly; `npm run build:sdk` produces the standalone ES module build (type declarations, the `.wasm` and the capture worklet) in `packages/ghostpacket-sdk/dist`.

```powershell
npm run build:sdk                # → packages/ghostpacket-sdk/dist
npm run test:sdk                 # Node: seal, verify, E2EE, ledger, keyring, sync, ultrasonic, Chimera bundles, round ledgers, LAN codes
npm run test:sdk:browser         # headless Chrome: sound and light, both directions, fake mic + camera
npm pack ./packages/ghostpacket-sdk/dist   # ghostpacket-sdk-0.3.0.tgz, then in your app: npm install ../ghostpacket-sdk-0.3.0.tgz
```

```js
import { GhostPacketSDK } from "ghostpacket-sdk";

const gp = await GhostPacketSDK.load();      // or load({ wasm, workletUrl, storage, seed })
const sealed = gp.sealMessage({ sender: "Ndiob clinic", title: "Rx 0042", message: "Amoxicillin 500 mg" }, { passphrase: "baobab moon" });
if (sealed.ok) await gp.transmitAcoustic(sealed.value.frame);   // or transmitOptical(frame, canvas, abortSignal)

// Receiver: receiveAcoustic({ onFrame }) or receiveOptical(video, onFrame), then for each frame
const v = gp.verifyFrame(frame, { passphrase: "baobab moon", strictKeyring: true });
```

In a page without a bundler, map `ghostpacket-sdk`, `jsqr` and `qrcode-generator` with an import map: see `packages/ghostpacket-sdk/examples/browser/index.html`. In Node, storage falls back to memory and the acoustic and optical I/O methods are not available; sealing, verification and sync work.

## Server verifier and offline-to-cloud sync

A field device verifies frames offline. Each verified frame also goes into a local **proof outbox** (Test page, or `gp.queueProof`). When the network returns, the outbox uploads the frames to `ghostpacket-verifier`, which runs the same Rust verification again and keeps its own anti-replay ledger. A voucher redeemed on two offline devices is accepted once (201) and reported as a double spend the second time (409).

```powershell
cargo build --release --manifest-path crates/ghostpacket-verifier/Cargo.toml
$env:GHOSTPACKET_TOKEN = "…"   # optional bearer token; GHOSTPACKET_PASSPHRASE for encrypted proofs
# --trust <issuer key hex> pins the issuers (strict keyring); --tofu accepts any valid signer instead
crates/ghostpacket-verifier/target/release/ghostpacket-verifier serve `
  --addr 127.0.0.1:8787 --ledger proofs.jsonl --trust <issuer key hex> `
  --allow-origin https://arthurnsongan.github.io
# Batch check of files; exit code 1 if any fails
crates/ghostpacket-verifier/target/release/ghostpacket-verifier verify a.gpkt b.gpkt --trust <issuer key hex>
```

```js
gp.queueProof(frame, v.value, "light");                       // stored locally, ciphertext if E2EE
const report = await gp.syncProofs("https://verifier.example.org", { token });
// pending → synced (201) | replay (409, double spend) | rejected (422); 5xx and network errors stay pending
const stop = gp.enableAutoSync("https://verifier.example.org");  // sync each time the browser is back online
```

`POST /v1/proofs` takes the raw frame (`Content-Type: application/octet-stream`, ≤ 512 bytes). The server bounds every request (5 s deadline, 2 KiB of headers, one `Content-Length`, ≤ 32 connections and 4 per IP, rate limit), only answers CORS for the one `--allow-origin`, writes each redemption to disk before answering 201, and echoes no document field for encrypted proofs. The site sends nothing until a verifier URL is typed in; the URL must be `https://`, or `http://` on localhost. Chrome may ask for "local network access" when the https site posts to a verifier on `localhost`.

Known limitation: whoever overhears a broadcast can upload it first, and the honest upload then shows as a replay. The token limits who can submit.

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

- **Specs** (`.kiro/specs/`): seven specs (`core-system`, `binary-protocol`, `acoustic-fsk`, `optical-fountain`, `judge-demo-ui`, `platform-v2`, `sdk-and-sync`) with EARS requirements, a design and a task list. The design docs record the measured results and the decisions that came out of failing tests.
- **Steering** (`.kiro/steering/`): `product`, `tech` and `structure` are always included. `wasm-determinism` is loaded on `crates/**/*.rs` and forbids panics, implicit randomness and unbounded allocations. `ui-design-system` is loaded on `apps/*/src/**` and `packages/ghostpacket-ui/src/**` and carries the "Spectral Telemetry" visual system.
- **Hooks** (`.kiro/hooks/`, v1 format):
  - `fuzz-noise-channel` runs the acoustic and optical fuzz suites whenever a codec file is saved.
  - `wasm-no-panic-guard` rejects `unwrap`, `expect` and `panic!` in `src/`.
  - `ts-typecheck-on-save` runs `tsc --noEmit`.
  - `kiroween-audit` runs on `Stop` and checks `.kiro/` tracking, secrets, the licence, WASM size and the full test suite.
- **Custom agent** (`.kiro/agents/dsp-security-auditor.md`): a read-only reviewer for DSP correctness and security. It audited V2 before release; its findings (decrypted titles written to the ledger, mic failure above 50 kHz, PBKDF2 cost, key zeroization, NFC passphrases, empty-passphrase fallback) were fixed and are listed in `.kiro/specs/platform-v2/design.md`.
- **MCP** (`mcp-server/`): `ghostpacket-inspector` loads the same `.wasm` binary as the browser and exposes three tools: `inspect_frame_hex`, `run_channel_benchmark` and `check_kiroween_compliance`.

The fuzz hook caught two real bugs in the fountain code:
- The low bits of `xorshift64*` are weak, so one block was never covered on some sessions.
- The planned degree distribution needed about 1.5 K droplets.

Both fixes are documented in `.kiro/specs/optical-fountain/design.md`.

An "air" test (clock drift between devices plus room echo) then showed the acoustic demodulator failing from ±100 ppm with echo, the normal gap between a PC and a phone. An early-late symbol timing tracker fixed it; the case is now part of the fuzz suite (`.kiro/specs/acoustic-fsk/design.md`).

## Security

- The signing key comes from 32 bytes of `crypto.getRandomValues`, stays in the tab's memory and is never sent anywhere.
- The issuer's public key is inside the signed document. An optional keyring rejects unknown issuers with `UNTRUSTED_ISSUER`.
- Optional end-to-end encryption (ChaCha20-Poly1305, PBKDF2-HMAC-SHA256 40 000 iterations, NFC passphrase, fresh 16-byte salt per frame). Derived keys and decrypted plaintext are zeroized in WASM. The ledger and keyring store public data only (ids, fingerprints, public keys), never message text.
- Untrusted lengths are bounded before allocation: frame ≤ 512 bytes, decompressed size ≤ 4096 bytes (LZ4 bomb blocked), ≤ 256 pending droplets.
- No network call at runtime: fonts are self-hosted and the WASM is served from the same origin. The only exception is opt-in proof sync to a verifier URL you enter; the token stays in memory.
- The server verifier was reviewed by `dsp-security-auditor`; its findings (whole-request deadline, strict HTTP parsing, origin check, connection and rate limits, weak keys accepted for pinning, decryption oracle, ledger durability) were fixed and are covered by `crates/ghostpacket-verifier/tests/verifier.rs`.

## Licence

MIT, see [LICENSE](LICENSE).
