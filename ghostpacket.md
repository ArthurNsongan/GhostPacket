# Project: GhostPacket
**Kiroween 2026 category:** Frankenstein (or Resurrection)  
**Concept:** 100 % offline (air-gap) sync of critical data and cryptographic proofs over sound waves (FSK) and an optical stream (Fountain QR).

> Original project brief. The refined, authoritative requirements live in `.kiro/specs/`.

---

## 1. Real problem
In low-coverage areas, during power or Internet outages, or in crowded settings (markets, rural clinics), two nearby devices cannot always sync a transaction receipt, a prescription or a tontine record without a cloud server or tedious Bluetooth pairing.

## 2. Technical innovation ("The Chimera")
**GhostPacket** fuses three engineering disciplines in the browser:
1. **Native compression & cryptography (Rust → WebAssembly):**
   - Compact binary serialization + LZ4 compression shrinking a structured document (tontine receipt, prescription) to **150 – 300 bytes**.
   - **Ed25519 digital signature (64 bytes)** + **CRC32** integrity check guaranteeing the packet's authenticity with no central authority.
2. **Channel A — Acoustic FSK modem (Web Audio API):**
   - Frequency-shift keying (multi-carrier FSK) played on the speaker.
   - Real-time demodulation from the microphone with a **Fast Fourier Transform (FFT)** and preamble synchronization.
3. **Channel B — Fountain-coded optical stream (Animated Fountain QR):**
   - The packet is split into XOR droplets (Luby Transform codes) shown as a fast burst on screen.
   - Full reconstruction on the camera side even if **30 % of the images** are missed or blurred, with no return channel.

## 3. Architecture & stack
- **DSP & crypto core:** Rust compiled to `wasm32-unknown-unknown` (`wasm-pack`).
- **Interface & audio/video:** Next.js + TypeScript + Web Audio API + Canvas API.
- **Judge demo mode:** *Dual-Canvas* interface (emitter on the left, receiver with FFT spectrogram and block reconstruction bar on the right) + a real computer ↔ phone test shown on video.

## 4. Binary frame structure
```text
[Sync preamble: 4B] [Version: 1B] [Flags: 1B] [Length: 2B] [LZ4 payload: NB] [CRC32: 4B] [Ed25519 signature: 64B]
```

## 5. Kiro integration (`.kiro/`)
- **`.kiro/specs/binary-protocol/`:** bit-exact specification of the frame, the FSK carrier frequencies and Ed25519 verification.
- **`.kiro/steering/wasm-determinism.md`:** determinism constraints, zero panic (`unwrap()` forbidden) and strict memory management in the Rust/WASM crate.
- **`.kiro/hooks/fuzz-noise-channel.json`:** hook running a noise-resistance test (white audio noise injection and random loss of 30 % of optical frames) on every codec change.

# .kiro/specs/core-system/requirements.md (initial draft)

## 1. System goal
Build an autonomous, deterministic system that an external evaluator can test end to end in under 30 seconds with no local hardware setup.

## 2. Functional requirements (user stories)
- **US-01 (Instant execution):** As an evaluator, I want to run a complete scenario in 1 click from the deployed web app, so that I can check that the engine really works.
- **US-02 (Strict physical bounds):** As the protocol engine, every generated payload must respect the imposed maximum (160 bytes/characters for USSD, or a bounded binary frame for GhostPacket).
- **US-03 (Integrity check):** Any data altered or corrupted in transit must be rejected with an explicit error message.
- **US-04 (Offline resilience / fallback):** If an external service is unavailable, the system switches automatically to deterministic local processing without interrupting the user.

## 3. Acceptance criteria
- [x] Median response time < 500 ms for local/WASM operations.
- [x] 100 % of the constraint unit tests (length, checksum, state transitions) pass through the Kiro hook.
- [x] No secret or API key exposed on the client side.
