# GhostPacket V2 — Master Upgrade Plan (Kiroween 2026)

> **Status**: implemented and deployed. Spec: `.kiro/specs/platform-v2/`. Verified by 51 Rust tests, 26 headless-Chrome checks and a `dsp-security-auditor` review (findings fixed). Deviations are noted in italics below.

> **Objective**: Transform GhostPacket into a complete, developer-ready, GitHub Pages-deployed product engineered to maximize all three Kiroween 2026 judging criteria (**Potential Value**, **Quality & Design**, **Implementation / Kiro Usage**).

---

## 1. GitHub Pages Site Structure (4-Page Static Export)

Persistent top navigation bar (glassmorphic obsidian header, audio-reactive spectral sigil, live `AIR-GAP READY / OFFLINE ACTIVE` badge, `UI SFX` toggle, and `Kiro Telemetry` drawer):

```text
[Sigil] GhostPacket     [ Home ]  [ How It Works ]  [ Simulation ]  [ Test (PC ↔ Phone) ]     [● AIR-GAP READY]
```

| Route | Section | Core Content |
|---|---|---|
| `/` | **Home** | Neo-Gothic *Spectral Telemetry* hero, concise value proposition, CTAs (**Launch 20s Simulation** & **Test PC ↔ Phone**), 3 real-world field use cases (Tontine, Rural Clinic, Humanitarian Aid), verified performance numbers (`< 1 ms` sign, `0` network calls, `50%` QR loss survival, `241 KB` WASM), Security & SDK highlights. |
| `/how-it-works` | **How It Works · Security · SDK** | 1. **Animated End-to-End Pipeline**: *Plaintext → Postcard + LZ4 → Optional E2EE → CRC32 + Ed25519 → 4-FSK Sound / Luby Transform QR → Verified Plaintext*.<br>2. **Security Architecture & Threat Model**: interactive defense matrix covering tampering, forgery, eavesdropping (E2EE), replay attacks, LZ4 bombs, and zero-exfiltration.<br>3. **Integrate in Your App (SDK)**: copy-paste TypeScript/React/Vanilla JS snippets, offline-to-cloud sync pattern, `.gpkt` binary wire format, and live `.gpkt` drag-and-drop verifier. |
| `/simulation` | **Simulation** | Upgraded Dual-Canvas Virtual Lab: **1-Click Spectral Demo (< 20s)**, **Chimera Dual-Channel Race** (sound + light simultaneously with live sabotage failover), **Custom Message Composer** (type any message + optional E2EE passphrase), **The Ether Conduit** animated signal bridge, **Blood Moon Alert**, **Curse Any Byte** interactive hex inspector + 3 attack scenarios (`CRC32_MISMATCH`, `INVALID_SIGNATURE`, `UNTRUSTED_ISSUER`), and **The Crypt Ledger** (anti-replay history). |
| `/test` | **Test (PC ↔ Phone)** | Real air-gap transfer between two physical devices: **Send** ↔ **Receive** role switch, **Write Your Own Message** form (Sender, Title, Plaintext Message) or 1-click preset, optional **E2EE Passphrase**, live step-by-step transmission metrics (FSK speaker waveform / fullscreen Fountain QR burst), and on the receiving phone: real microphone spectrogram or rear camera viewfinder + Fountain block cascade → **Verified Plaintext Message Reveal** with Ed25519 seal, **Trusted Keyring Identity QR**, and **Anti-Replay Crypt Ledger**. |

---

## 2. Detailed Feature Specifications

### 2.1 Custom User Messages (`DocumentBody::CustomMessage`)
- **Rust (`crates/ghostpacket-core/src/schema.rs`)**:
  - New variant `CustomMessage { sender: String, title: String, message: String }` (`doc_type = 0x04`) with bounded field lengths (`sender <= 48 B`, `title <= 64 B`, `message <= 240 B`) guaranteeing total frame size `<= 512 B`.
- **Web UI (`/simulation` & `/test`)**:
  - Plain-text composer (no raw JSON required) with live byte counter (`payload / 436 B` & `frame / 512 B`).
  - Receiver displays the reconstructed message clearly in plaintext alongside sender identity, channel, latency, and Ed25519 verification badge.

### 2.2 Security Pillar (*Cryptographic Armor*)
1. **Optional End-to-End Encryption (`FLAG_ENCRYPTED = 0x10`)**:
   - Protects sensitive medical prescriptions or private messages transmitted over audible sound or visible QR codes in public spaces.
   - Pure-Rust, zero-panic AEAD (`chacha20poly1305`) with passphrase key derivation (`sha2` / iterated PBKDF2-HMAC-SHA256) and deterministic nonce derived from frame metadata + salt.
   - Off by default (1-click demo stays instant), toggleable in 1 click. When enabled, the hex inspector marks the payload as encrypted ciphertext (`ENC`); wrong passphrase returns `DECRYPTION_FAILED`, correct passphrase reveals clear plaintext.
2. **Interactive 3-Layer Tamper Lab (« Curse Any Byte »)**:
   - Clicking **any byte** in `FrameInspector` flips 1 bit live and immediately demonstrates which defense caught it (`INVALID_PREAMBLE`, `UNSUPPORTED_VERSION`, `CRC32_MISMATCH`, or `CRC32 ✓` + `INVALID_SIGNATURE ✗`).
   - Three 1-click attack buttons: **Curse Payload (CRC32)**, **Curse Signature (Ed25519)**, **Forge Rogue Key (`UNTRUSTED_ISSUER`)** + **Restore Intact Frame**.
3. **Anti-Replay Protection (« The Crypt Ledger »)**:
   - Persistent local storage of verified `docId`s, issuer fingerprints, timestamps, and channel.
   - Re-receiving an already-recorded `docId` raises **`REPLAY DETECTED · ALREADY REDEEMED`** to prevent offline double-spending of vouchers or receipts.
4. **Trusted Keyring Ceremony (Identity QR)**:
   - Emitter generates a static **Identity QR** (`GPKT-KEY:<label>:<pubkey_hex>`).
   - Receiver pins trusted issuers via camera scan or 1-click trust, enabling strict keyring mode (`UNTRUSTED_ISSUER` rejection).
5. **Hardening & Offline PWA Guarantee**:
   - Zero-panic Rust `src/`, bounded allocations (`<= 512 B` frame, `<= 4096 B` LZ4 anti-bomb cap, `<= 256` pending droplets), ephemeral CSPRNG key in RAM, self-hosted fonts & WASM, offline cache-first Service Worker (`web/public/sw.js`) with live `OFFLINE · AIR-GAP ACTIVE` badge.

### 2.3 Developer SDK & Third-Party App Integration
- **Clean SDK Facade (`web/src/lib/sdk.ts`)**:
  - `GhostPacketSDK` wrapping WASM + Web Audio + Canvas QR + Camera + Ledger + Keyring:
    - `sealMessage(draft, opts?)` / `verifyFrame(bytes, opts?)`
    - `transmitAcoustic(...)` / `receiveAcoustic(...)`
    - `transmitOptical(...)` / `receiveOptical(...)`
    - `exportGpktFile(frame)` / `importGpktFile(file)`
- **Integration Hub (`/how-it-works`)**:
  - Copy-paste integration snippets for **Vanilla JS / PWA**, **React**, **Offline-to-Cloud Sync Bridge** (queue verified `.gpkt` proofs locally and sync when connectivity returns), and **Rust (`ghostpacket-core`)**.
  - Live `.gpkt` export and drag-and-drop verification dropzone.

### 2.4 Frankenstein Killer Feature — « Chimera Dual-Channel Race »
- Simultaneously transmits over **both** 4-FSK audio and Fountain QR in `/simulation`.
- Live sabotage buttons (**Jam Audio 0 dB** / **Block Camera 85%**) allow judges to kill either channel mid-transmission and watch the surviving channel finish and verify Ed25519 seamlessly.

### 2.5 Haunted Precision UI Upgrade (Halloween Neo-Gothic Theme)
- **The Ether Conduit (`EtherConduit.tsx`)**: 60 FPS animated bridge between Emitter and Receiver — live ectoplasm FSK waveform distorting under noise, and amethyst/ectoplasm Fountain orbs shattering into crimson embers on dropped QR frames.
- **Blood Moon Alert**: ambient mist briefly shifts to crimson (`1.4s`) whenever a corrupted, forged, or untrusted frame is rejected.
- **Tactile Polish**: cursor-tracking border spotlight on `.panel` cards, audio-reactive geometric sigil in the header, cascade domino badges (`CASCADE ×N`, `GAUSS GF(2)`) in `FountainGridCanvas`, optional pure Web Audio UI SFX (`ui-sfx.ts`), and a **Kiro Telemetry** modal showing live WASM latencies, binary size, test count, and `.kiro/` architecture.

---

## 3. Execution Roadmap (5 Phases)

### Phase 1 — Kiro Specs, Steering & Custom Agent
- [x] Add `.kiro/specs/platform-v2/{requirements.md,design.md,tasks.md}` (EARS format).
- [x] Add `.kiro/agents/dsp-security-auditor.md` (Kiro custom agent). *Kiro agents are Markdown files with YAML front matter; a `.json` file would not be loaded.*
- [x] Update `.kiro/steering/ui-design-system.md` with *Ether Conduit*, *Blood Moon*, *Spotlight*, and 4-page navigation specs.

### Phase 2 — Rust/WASM Core (`crates/ghostpacket-core`)
- [x] Add `DocumentBody::CustomMessage` (`doc_type = 0x04`) in `schema.rs` + tests.
- [x] Add optional AEAD encryption (`FLAG_ENCRYPTED = 0x10`, pure-Rust `chacha20poly1305` + PBKDF2-HMAC-SHA256, 40 000 iterations) + `DECRYPTION_FAILED` / `PASSPHRASE_REQUIRED` error codes + zero-panic tests. *The nonce is derived with the key from passphrase + fresh caller salt (not from frame metadata). The title bound is 60 B, not 64: at 64 the worst-case encrypted message overshoots the 436-byte payload by 3 bytes.*
- [x] Rebuild WASM (`npm --prefix web run wasm`) and verify `< 350 KB gzip` + `no-panic-guard` = 0 violations.

### Phase 3 — SDK, Ledger, Keyring, Offline SW & Field Fixes
- [x] Implement `web/src/lib/sdk.ts`, `web/src/lib/ledger.ts`, `web/src/lib/keyring.ts`, `web/src/lib/ui-sfx.ts`.
- [x] Add `web/public/sw.js` (offline cache-first Service Worker) + registration & network status indicator.
- [x] Add energy squelch to `MicReceiver.probe()`, remove `FLAG_DEMO` from Field Mode emissions, and immediately re-ingest droplet on `DROPLET_SESSION_MISMATCH`.

### Phase 4 — 4-Page GitHub Pages App & Haunted Precision UI
- [x] Update `web/next.config.ts` (`trailingSlash: true` for clean static routing on GitHub Pages) and create `AppShell.tsx` with 4-page navbar (`Home`, `How It Works`, `Simulation`, `Test`).
- [x] Implement `/` (`Home`), `/how-it-works` (Pipeline + Security Threat Model + SDK Integration Hub), `/simulation` (Custom Message + E2EE + Chimera Race + Ether Conduit + Blood Moon + Interactive Byte-Curse + Crypt Ledger), and `/test` (Custom Message Plaintext PC ↔ Phone + E2EE + Trusted Keyring QR + Crypt Ledger).

### Phase 5 — GitHub Pages Deployment & Final Audit
- [x] Static deployment to GitHub Pages with HTTPS. *Actions jobs on this account are blocked by billing, so the site is published with `node scripts/deploy-gh-pages.mjs` (gh-pages branch); the existing `.github/workflows/pages.yml` stays as a manual Actions alternative.*
- [x] Run `node scripts/kiroween-audit.mjs --full`, `node mcp-server/src/smoke.ts`, and `npm --prefix web run build`.
- [x] Verify all 4 pages in browser (0 console errors, 0 external network requests, demo < 20s, custom message end-to-end, encryption toggle, interactive byte-curse, anti-replay).
- [x] Update `README.md`, commit to `main`, push to GitHub Pages.
- [ ] Run the real PC ↔ Phone airplane-mode test and record the 3-minute Devpost demo video (needs the physical devices).
