# GhostPacket V3 — Master Plan: "Skeleton Crew" Edition (Kiroween 2026)

> **Category**: **Skeleton Crew** (Kiroween 2026) — One lean, reusable air-gap & offline-to-cloud sync skeleton (`crates/ghostpacket-core` + `packages/ghostpacket-sdk` + `packages/ghostpacket-ui`) powering **two genuinely distinct, database-backed applications** (`apps/ghost-clinic` and `apps/ghost-tontine`) plus a 4-section GitHub Pages showcase & testbench (`apps/portal`).

---

## 1. Monorepo Architecture (Skeleton Crew Compliant)

```text
GhostPacket/
├── .kiro/                             # Specs EARS, Steering, Hooks v1, MCP settings, Custom Agent
├── .github/workflows/deploy-pages.yml # Unified HTTPS GitHub Pages deploy: /, /clinic/, /tontine/
├── crates/
│   └── ghostpacket-core/              # Rust -> WASM Engine (GPKT v1 & v2, E2EE, 4-FSK, OFDM, Ultrasonic, Fountain QR, ChromaCrypt)
├── packages/
│   ├── ghostpacket-sdk/               # Drop-in TypeScript SDK (Transports, Image Codec, Keyring, IndexedDB, Offline-to-Cloud Sync)
│   └── ghostpacket-ui/                # Shared "Spectral Telemetry" UI primitives (EtherConduit, Spectrogram, ColorMatrix, Seal, SyncPill)
├── apps/
│   ├── portal/                        # GitHub Pages Hub: Home, How It Works (Security + SDK), Simulation, Test (PC <-> Phone)
│   ├── ghost-clinic/                  # DISTINCT APP #1: Rural Offline Clinic & Medical Image Transfer + Patient DB + Cloud Sync
│   └── ghost-tontine/                 # DISTINCT APP #2: Community Tontine Treasury & Anti-Replay Ledger + Member DB + Cloud Sync
├── supabase/
│   ├── migrations/001_v3_schema.sql   # Postgres schema (profiles, trusted_keys, ghost_packets, sync_conflicts) + strict RLS
│   └── functions/verify-packet/       # Edge Function: server-side Ed25519 + SHA-256 + global anti-replay verification
└── mcp-server/                        # Kiro MCP Server (frame inspection, OFDM/ChromaCrypt benchmarks, Skeleton Crew compliance audit)
```

---

## 2. High-Speed Air-Gap Transports & Complex Image Payloads

### 2.1 Protocol `GPKT v2` (Backward-Compatible with `v1 <= 512 B`, Streaming up to `128 KB`)
```text
[Sync: 4B "GPKT"] [Ver: 1B = 0x02] [Flags: 1B] [PayloadLen: 4B u32]
[Payload: Postcard + LZ4 + optional ChaCha20-Poly1305 AEAD, <= 128 KB]
[AttachmentSHA256: 32B (if HAS_ATTACHMENT)] [CRC32: 4B] [Ed25519 Signature: 64B]
```
- **Supported Payloads**: `TontineReceipt`, `MedicalPrescription`, `EmergencyVoucher`, `CustomMessage` (free user plaintext), **`ImageDocument`** (structured metadata + compressed WebP/JPEG image `4 KB – 64 KB`), and **`LedgerBatchDelta`** (multi-record offline sync bundle).
- **Client-Side Progressive Image Codec (`image-codec.ts`)**: accepts any user image (upload or camera capture), downscales & encodes to target size budgets (`Micro 4 KB`, `Standard 16 KB`, `High 48 KB`) with live size preview before transmission.

### 2.2 Five Air-Gap Physical Transports

| Channel | Mechanism | Target Throughput | 16 KB Image Time | Primary Use Case |
|---|---|---|---|---|
| **1. `ChromaCrypt` (NEW — High-Speed Optical)** | **High-Density Color Optical Matrix** (Cimbar/JAB-inspired) + **Luby Transform Fountain**: `24x24` to `32x32` grid × **8 perceptually orthogonal colors** (`3 bits`) + **4 geometric tile patterns** (`2 bits`) = **5 bits/tile** (~400–600 B/frame). Four corner **RGBCMYKW white-balance calibration patches** + Rust/WASM perspective homography + Reed-Solomon + LT Fountain. | **40 – 120 kbps** (5 – 15 KB/s @ 12–15 FPS) | **1.5 – 3.5 s** (even with 30% dropped frames) | **Complex images** (clinical photos, X-rays, ID cards) & rich payloads screen → camera |
| **2. `Acoustic OFDM` — *Spectral Chord* (NEW)** | **16–32 orthogonal subcarriers** (`1.2–7.2 kHz`, QPSK per FFT bin, cyclic prefix against room echo, RS GF(256)) via `rustfft` in WASM. | **2.4 – 6.4 kbps** (~20x faster than 4-FSK) | ~20 s (or **2 KB batch in ~3 s**) | Fast camera-less broadcast to **multiple receivers simultaneously** over speaker |
| **3. `Ultrasonic Whisper` (NEW)** | **17.5 – 19.8 kHz** near-inaudible FSK/Chirp handshake (captured by 48 kHz mics). | **200 – 500 bps** | N/A (≤ 256 B) | Silent identity/keyring exchange, session pairing & WebRTC SDP signaling |
| **4. `Chimera Turbo` (Hybrid Aggregation)** | Runs **ChromaCrypt (Light) + Acoustic OFDM (Sound) simultaneously** feeding one **unified Fountain LT decoder**. | Combined rate + zero-downtime failover | **1.2 – 2.5 s** | Live proof: jam audio or occlude camera mid-image transfer; decoding completes seamlessly |
| **5. `WebRTC QR-Signaled LAN` (NEW — Zero-Server P2P)** | Exchanges compressed SDP offer/answer via 1 QR or Ultrasonic chirp on a shared Wi-Fi/hotspot (no Internet required) → encrypted local **WebRTC DataChannel** verified with Ed25519. | **5 – 50 Mbps** | **< 0.05 s** (multi-MB capable) | High-volume local DB sync & HD attachments between nearby devices |

*(Legacy **4-FSK Robust** and **Monochrome Fountain QR** remain available for extreme-noise / low-end hardware fallback.)*

---

## 3. Real User Database & Offline-to-Cloud Synchronization

### 3.1 Local-First Storage (`IndexedDB` + Service Worker PWA)
- Offline-first source of truth in `packages/ghostpacket-sdk/src/sync/`:
  - `identity` (user profile + local Ed25519 keypair + optional X25519 encryption key)
  - `trusted_issuers` (pinned public keys from QR/Ultrasonic trust ceremonies)
  - `records` & `blobs` (structured records + binary images indexed by SHA-256)
  - `outbox` (signed `GPKT` frames queued with Hybrid Logical Clock `HLC` timestamps)
  - `replay_guard` (local `doc_id` anti-replay set)

### 3.2 Cloud Backend (`Supabase Postgres + Auth + Storage`)
- **Authentication**: Real user sign-in (Email / Magic Link) + **1-Click Judge Demo Account** so evaluators test instantly without registration friction.
- **Database Schema (`supabase/migrations/001_v3_schema.sql`)**:
  - `profiles`: user ID, display name, role (`clinician` / `pharmacist` / `treasurer` / `member`), `ed25519_pubkey`, `fingerprint`.
  - `trusted_keys`: synchronized user keyring with verification provenance (`qr`, `ultrasonic`, `manual`).
  - `ghost_packets`: `doc_id UNIQUE` (enforces **global cross-device anti-replay**), `app_scope` (`clinic` | `tontine`), `doc_type`, `raw_frame_b64`, `payload_json`, `is_encrypted`, `attachment_sha256`, `channel_used`, `hlc_timestamp`, `server_verified`.
  - `sync_conflicts`: audit log of offline double-spend / duplicate `doc_id` collisions detected upon reconnection.
  - **Storage Bucket (`ghost-attachments`)**: stores signed/encrypted attachment blobs keyed by `attachment_sha256` (zero-knowledge when E2EE is enabled).
- **Server-Side Cryptographic Verification (`supabase/functions/verify-packet`)**: re-verifies Ed25519 signature, SHA-256 attachment integrity, and `doc_id` uniqueness when offline devices reconnect and flush their `outbox`.
- **Zero-Config Fallback (US-04)**: When Supabase credentials are absent (e.g., local offline build), seamlessly falls back to a cross-tab `BroadcastChannel` + `IndexedDB` cloud sync simulator so 100% of features remain demoable with zero setup.

---

## 4. Two Distinct Applications Built From the Skeleton

### App #1 — `apps/ghost-clinic/` (**GhostClinic**: Rural Offline Healthcare & Medical Imaging)
- **Workflow**: Rural clinician creates a signed patient record + prescription + **compressed clinical image** (malaria RDT strip, X-ray crop, dermatology photo, or custom upload up to 48 KB) while offline → transmits via **ChromaCrypt Color Matrix** with **E2EE enabled** to pharmacy/specialist phone → phone decrypts & reveals the **clear plaintext record + progressive image** → when either device regains connectivity, `SyncEngine` syncs encrypted/signed records to Supabase Postgres and flags any attempted double-dispensing (`REPLAY_DETECTED`).

### App #2 — `apps/ghost-tontine/` (**GhostTontine**: Community Finance & Anti-Replay Treasury)
- **Workflow**: Tontine treasurer manages real member accounts & contribution rounds offline → issues signed receipts, one-time aid vouchers, or **Batch Ledger Deltas** (20 contributions in one burst) → broadcasts to multiple member phones simultaneously via **Acoustic OFDM** or transfers via **ChromaCrypt / Fountain QR / WebRTC LAN** → enforces strict local + cloud **Anti-Replay** on every voucher/receipt `doc_id` → syncs full ledger state & conflict alerts to Supabase upon reconnection.

---

## 5. GitHub Pages Portal & Haunted Precision UI (`apps/portal`)

4-section top navigation (`Home` · `How It Works` · `Simulation` · `Test PC ↔ Phone`) + direct launchers to **`GhostClinic`** (`/clinic/`) and **`GhostTontine`** (`/tontine/`):

1. **`/` (`Home`)**: Neo-Gothic *Spectral Telemetry* hero, audio-reactive sigil, live `AIR-GAP READY / CLOUD SYNCED` pill, instant launchers to **GhostClinic**, **GhostTontine**, **Simulation**, and **Test (PC ↔ Phone)**.
2. **`/how-it-works`**: Interactive V3 pipeline visualizer, **Security Architecture & Threat Model** (Integrity, Authenticity, Optional E2EE ChaCha20-Poly1305/X25519, Anti-Replay Local+Cloud, LZ4/Image Bomb Defense, Zero-Panic WASM), and **Skeleton Crew SDK Hub** (copyable React / Vanilla / Sync / Rust snippets + `.gpkt` dropzone).
3. **`/simulation`**: Dual-Canvas Virtual Lab with **Custom Plaintext Message & Custom Image Upload**, selectable transports (`4-FSK`, `OFDM`, `Fountain QR`, `ChromaCrypt`, `Chimera Hybrid Race`), **Progressive Spectral Image Materialization** under 30% loss, *Ether Conduit*, *Blood Moon Alert*, interactive *Curse Any Byte* (4 attack scenarios), and live Offline → Online Cloud Sync toggle.
4. **`/test`**: Real **PC ↔ Phone** air-gap workbench — type your own message **and/or attach any image**, pick transport & optional E2EE passphrase, transmit via real speaker or screen, and watch the **message in clear plaintext + reconstructed image** appear on the phone with `ED25519 VERIFIED`, Trusted Keyring QR, and 1-click Cloud Sync.

---

## 6. Phased Implementation Plan (Nov 25 – Dec 4, 2026)

- **Phase 1 (Day 1 — Nov 25)**: Skeleton Crew monorepo refactor (`packages/ghostpacket-sdk`, `packages/ghostpacket-ui`, `apps/portal`, `apps/ghost-clinic`, `apps/ghost-tontine`), Kiro EARS specs (`.kiro/specs/v3-skeleton-crew/`, `.kiro/specs/high-speed-transports/`), Custom Agent (`.kiro/agents/dsp-security-auditor.json`), updated `kiroween-audit.mjs`.
- **Phase 2 (Days 2–3 — Nov 26–27)**: Rust/WASM V3 engine — `GPKT v2` (≤ 128 KB + `CustomMessage` + `ImageDocument` + `LedgerBatchDelta`), optional AEAD E2EE (`chacha20poly1305` + X25519/PBKDF2), **Acoustic OFDM**, **Ultrasonic Whisper**, **ChromaCrypt Color Matrix + Homography + Fountain**, full fuzz tests (`0` panics).
- **Phase 3 (Day 4 — Nov 28)**: `@ghostpacket/sdk`, IndexedDB store, Supabase Postgres migrations + RLS + `verify-packet` Edge Function + zero-config mock fallback, Service Worker PWA (`sw.js`), WebRTC QR-Signaled LAN transport.
- **Phase 4 (Days 5–6 — Nov 29–30)**: `packages/ghostpacket-ui` (*Ether Conduit*, *Blood Moon*, *Progressive Image Reveal*, *Curse Any Byte*, *UI SFX*) and `apps/portal` 4-page GitHub Pages hub.
- **Phase 5 (Days 7–8 — Dec 1–2)**: Build both distinct applications (`apps/ghost-clinic/` and `apps/ghost-tontine/`) consuming the exact same skeleton packages and cloud sync schema.
- **Phase 6 (Day 9 — Dec 3–4)**: Unified GitHub Pages HTTPS deployment (`.github/workflows/deploy-pages.yml`), full `kiroween-audit.mjs --full` verification, physical PC ↔ Phone test (custom message + real image via ChromaCrypt + Airplane Mode → Cloud Sync), 3-minute Devpost demo video, and submission.
