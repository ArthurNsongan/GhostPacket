# GhostPacket V3 — Master Plan: "Skeleton Crew" Edition (Kiroween 2026)

> **Category**: **Skeleton Crew** (Kiroween 2026) — One lean, reusable air-gap & offline-to-cloud sync skeleton (`crates/ghostpacket-core` + `packages/ghostpacket-sdk` + `packages/ghostpacket-ui`) powering **two genuinely distinct applications** (`apps/ghost-clinic` and `apps/ghost-tontine`) plus a 4-section GitHub Pages showcase & testbench (`apps/portal`).

---

## 0. Status (November 24, 2026)

Live: https://arthurnsongan.github.io/GhostPacket/ (`/`, `/clinic/`, `/tontine/`). Specs: `.kiro/specs/v3-skeleton-crew/` and `.kiro/specs/high-speed-transports/`.

| Plan item | Status | Where |
|---|---|---|
| Skeleton Crew monorepo, 2 apps + portal | Done | `packages/*`, `apps/*` |
| GPKT v2 (≤ 128 KB), `CustomMessage`, `ImageDocument` | Done (layout changed, see §2.1) | `protocol.rs`, `schema.rs` |
| `LedgerBatchDelta` | Done: doc type 0x06, 1..=64 contributions, broadcast by GhostTontine over OFDM | `schema.rs`, `TontineApp.tsx` |
| Optional E2EE | Done: ChaCha20-Poly1305 + PBKDF2 (passphrase), on every transport including images | `encryption.rs`, `HighSpeedLab.tsx` |
| Image codec (Micro / Standard / High) | Done: 4 / 15 / 48 KB (Standard is 15 KB so it fits one OFDM burst) | `image-codec.ts` |
| ChromaCrypt | Done (3 bits per cell, see §2.2) | `chroma.rs`, `fountain_wide.rs` |
| Acoustic OFDM | Done | `ofdm.rs` |
| Ultrasonic Whisper | Done: identity cards ≤ 256 B; untested on real hardware | `fsk.rs`, `WhisperIdentity.tsx` |
| Chimera Turbo | Done: one wide-fountain decoder fed by matrices and OFDM droplet bundles | `fountain_wide.rs`, `chimera-turbo.ts` |
| WebRTC QR-signaled LAN | Done: offer by QR, answer by QR or OFDM, no server | `lan-link.ts`, `LanLinkPanel.tsx` |
| Persistent issuer identity | Done (not in the original plan): key sealed in a 101-byte vault | `vault.rs`, `identity.ts` |
| Cloud backend | **Changed**: `ghostpacket-verifier` (Rust, same core) instead of Supabase | `crates/ghostpacket-verifier` |
| IndexedDB store, HLC timestamps, blob store | **Not done**: localStorage collections, epoch timestamps, images inside the signed frame | `records.ts`, `storage.ts` |
| X25519 key agreement | **Not done**: E2EE uses a shared passphrase | — |
| Service worker PWA | Done (one worker per app scope) | `apps/*/public/sw.js` |
| GitHub Actions deploy | **Changed**: Actions billing blocked; `scripts/deploy-gh-pages.mjs` pushes the `gh-pages` branch | `scripts/` |
| MCP server | Done: frame inspection (with passphrase), channel and high-speed benchmarks (OFDM, ChromaCrypt, ultrasonic), compliance audit | `mcp-server/` |
| Physical PC ↔ phone test, demo video, Devpost submission | **To do** (needs the team and real devices) | — |

---

## 1. Monorepo Architecture (Skeleton Crew Compliant)

```text
GhostPacket/
├── .kiro/                             # Specs EARS, Steering, Hooks v1, MCP settings, Custom Agent (dsp-security-auditor)
├── crates/
│   ├── ghostpacket-core/              # Rust -> WASM: GPKT v1 & v2, E2EE, vault, 4-FSK (audible + ultrasonic), OFDM, fountain QR, ChromaCrypt, Chimera bundles
│   └── ghostpacket-verifier/          # Server verifier: same core, global anti-replay ledger, HTTP endpoint (replaces Supabase)
├── packages/
│   ├── ghostpacket-sdk/               # Drop-in TypeScript SDK (transports, image codec, keyring, identity vault, outbox sync, LAN link)
│   └── ghostpacket-ui/                # Shared UI (AirTransfer, HighSpeedLab, ChimeraTurboLab, LanLinkPanel, WhisperIdentity, ResultCard…)
├── apps/
│   ├── portal/                        # GitHub Pages hub: Home, How It Works, Simulation, Test (PC <-> Phone)
│   ├── ghost-clinic/                  # DISTINCT APP #1: rural clinic, prescriptions, clinical photos, pharmacy (dispense once)
│   └── ghost-tontine/                 # DISTINCT APP #2: savings group, receipts, round ledger broadcast, aid vouchers (pay out once)
├── scripts/                           # build, deploy (gh-pages), audit, e2e/ (headless Chrome suites)
└── mcp-server/                        # Kiro MCP server (frame inspection, OFDM / ChromaCrypt / ultrasonic benchmarks, audit)
```

---

## 2. High-Speed Air-Gap Transports & Complex Image Payloads

### 2.1 Protocol `GPKT v2` (backward-compatible with v1 ≤ 512 B, up to 128 KB)
```text
[Sync: 4B "GPKT"] [Ver: 1B = 0x02] [Flags: 1B] [PayloadLen: 4B u32 BE]
[Payload: postcard + LZ4 + optional ChaCha20-Poly1305 AEAD, ≤ 128 KB] [CRC32: 4B] [Ed25519 Signature: 64B]
```
- **Change from the first plan:** no separate `AttachmentSHA256` block. The image is inside the signed document, so CRC32 and the signature already cover every byte; the verifier reports the image SHA-256 instead of trusting a stored one.
- **Payloads**: `TontineReceipt`, `MedicalPrescription`, `EmergencyVoucher`, `CustomMessage`, **`ImageDocument`** (0x05: metadata + WebP / JPEG / PNG ≤ 64 KB) and **`LedgerBatchDelta`** (0x06: a whole round, 1..=64 contributions with their receipt ids). `sealCompact` keeps a v1 frame when the document fits.
- **Client-side image codec (`image-codec.ts`)**: upload or camera capture, re-encoded by the browser to Micro 4 KB, Standard 15 KB or High 48 KB, with a live size preview before signing.

### 2.2 Air-gap transports (measured in tests and headless Chrome)

| Channel | Mechanism | Measured | Use |
|---|---|---|---|
| **1. ChromaCrypt** (light) | 44×44 cells × **8 calibrated colors (3 bits)**, 4 finder patterns, calibration strip, homography, 3 interleaved RS codewords (525 B per matrix), wide LT fountain | 12 KB photo in ≈ 2.8 s at 15 FPS with 30 % of matrices lost (≈ 36 kbit/s) | photos, rich documents, screen → camera |
| **2. Acoustic OFDM** (*Spectral Chord*) | 32 DQPSK subcarriers 1.5–7.4 kHz, cyclic prefix, chirp sync, clock-slip tracker, RS(255,223) | ≈ 4 kbit/s: 12 KB in 24 s at 15 dB SNR; ±300 ppm, echo, clipping | camera-less broadcast to every phone in the room (round ledger) |
| **3. Ultrasonic Whisper** | the 4-FSK modem moved to 17.6–19.6 kHz, 5 ms symbols, ≥ 44.1 kHz | 400 bit/s: a 155 B signed identity card in 3.6 s; leakage under 16 kHz > 30 dB down | near-silent key exchange (pin the issuer) |
| **4. Chimera Turbo** | ChromaCrypt matrices **and** OFDM bundles of the same droplets, one wide-fountain decoder | 10.6 KB encrypted photo in 8 s with the camera covered for 6 s (both lanes count) | cover the camera or jam the sound mid-transfer: it never restarts |
| **5. WebRTC LAN** | DataChannel on the same Wi-Fi or hotspot; offer by QR, answer by QR or OFDM; host candidates only, no STUN / TURN / signaling server | ≈ 200-character codes, link in ≈ 2.5 s, then 10.6 KB in ≈ 10 ms | large transfers between nearby devices |

- **Change from the first plan:** ChromaCrypt uses colors only (3 bits per cell). Colour + 4 tile patterns (5 bits) needs several pixels per cell and fails first under camera blur.
- Legacy **4-FSK robust / fast** and **monochrome fountain QR** remain for extreme noise and low-end hardware.

---

## 3. Local data and offline-to-cloud synchronization

### 3.1 Local-first storage (as built)
- `localStorage` collections per app namespace (`records.ts`, `storage.ts`): patients, prescriptions, members, issued documents, wallet.
- Keyring of pinned issuers (identity QR, Ultrasonic Whisper, or "I checked the fingerprint" after a first document).
- Identity vault: the issuer's signing seed sealed by the core under a passphrase (PBKDF2 210k + ChaCha20-Poly1305); only the sealed vault is stored.
- Append-only anti-replay ledgers per scope (`ledger.ts`, fail closed) and a proof outbox (verified frames, ciphertext if E2EE, byte budget).
- Not done: IndexedDB and Hybrid Logical Clock timestamps.

### 3.2 Cloud side: `ghostpacket-verifier` (replaces Supabase)
- **Decision:** a Rust server that links the same `ghostpacket-core`, so the server runs exactly the browser's verification. Supabase was dropped: it needs credentials in the client, duplicates the verification logic in an Edge Function, and adds a network dependency to the demo.
- `POST /v1/proofs` re-verifies CRC32 and Ed25519 (and decrypts with a server passphrase if configured), enforces global `doc_id` anti-replay in an append-only JSONL ledger (a voucher paid on two offline devices is caught), accepts GPKT v2 and summarizes images (size, SHA-256).
- Opt-in only: nothing is sent until the user or the app sets an `https://` verifier URL; a bearer token stays in memory.

---

## 4. Two distinct applications built from the skeleton

### App #1 — `apps/ghost-clinic/` (GhostClinic: rural healthcare and clinical photos)
- The nurse keeps the ward on the device, signs a prescription (no patient name in the frame, optional E2EE) and hands it to the pharmacy phone (virtual hand-over, sound or light). The pharmacy dispenses once; a second presentation is refused (`REPLAY`).
- A clinical photo (rapid-test strip, wound) is re-encoded, signed into a GPKT v2 frame linked to the prescription and sent over ChromaCrypt or OFDM. The link is shown as trusted only if the issuer is pinned.

### App #2 — `apps/ghost-tontine/` (GhostTontine: savings group and anti-replay treasury)
- The treasurer records contributions and hands each member a signed receipt; one-time aid vouchers are paid out once at the pay-out desk.
- At the end of the meeting, the **round ledger** (`LedgerBatchDelta`) lists every contribution in one frame and is broadcast over the OFDM chord to every member phone at once; each phone keeps it once and lists which of its receipts it confirms.
- The treasurer's key can be whispered to members over Ultrasonic Whisper and pinned.

---

## 5. GitHub Pages portal (`apps/portal`)

1. **`/` (Home)**: hero, live `AIR-GAP READY` pill, launchers to GhostClinic, GhostTontine, Simulation and Test.
2. **`/how-it-works`**: pipeline, security architecture and threat model, SDK snippets, `.gpkt` verifier.
3. **`/simulation`**: dual-canvas virtual lab (custom message, E2EE, Chimera race, tamper lab, ledger) and the **V3 high-speed lab** (image over ChromaCrypt, OFDM, Chimera Turbo with live sabotage, or WebRTC LAN; optional E2EE with receiver unlock), plus the Ultrasonic Whisper panel.
4. **`/test`**: real PC ↔ phone workbench: message or image, any transport (including Chimera Turbo, ultrasonic and the LAN link), optional E2EE, keyring and opt-in sync.

---

## 6. Remaining work (Nov 25 – Dec 4, 2026)

1. **Physical tests** (team, two devices): clinic photo over ChromaCrypt with a phone camera; OFDM and Ultrasonic Whisper between a real speaker and microphone; Chimera Turbo in a room; WebRTC LAN on a phone hotspot. Record the numbers next to the simulated ones.
2. **3-minute demo video** and **Devpost submission**.
3. Optional: a dedicated origin instead of the shared `github.io` one; IndexedDB storage; X25519 key agreement.
